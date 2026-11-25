import { getAddress, keccak256, parseAbi, toHex, type PublicClient } from "viem";

/** Any viem client with multicall (the Base clients across the app differ in chain typing) */
type MulticallClient = Pick<PublicClient, "multicall">;
import { BASE_TOKENIZED_STOCKS } from "./tokenizedStocks";

/**
 * Watches the issuer controls on the 10 B20 stocks that could stop swaps without any change on our side.
 *
 * Since the Denim hardfork (Base mainnet 2026-11-05) an issuer can bind a policy to TRANSFER_EXECUTOR_POLICY,
 * checked on msg.sender of every transfer. Today all three transfer scopes use a blocklist that lets every
 * ordinary address through. If one becomes an allowlist (or blocks the router or the v4 PoolManager), or
 * transfers are paused, swaps revert. This check reads those rules onchain and says which stock changed.
 * Policy registry and scopes: docs.base.org/specifications/b20/reference/constants
 */

const POLICY_REGISTRY = "0x8453000000000000000000000000000000000002" as const;
const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as const;
const V4_POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b" as const;
/** A fresh address nobody controls: if a policy stops authorizing it, the scope became an allowlist */
const ORDINARY = getAddress(`0x${keccak256(toHex("maxxagent b20 guard probe")).slice(26)}`);

const SCOPES = {
  sender: keccak256(toHex("TRANSFER_SENDER_POLICY")),
  receiver: keccak256(toHex("TRANSFER_RECEIVER_POLICY")),
  executor: keccak256(toHex("TRANSFER_EXECUTOR_POLICY")),
} as const;
const TRANSFER_FEATURE = 0; // PausableFeature.TRANSFER

const tokenAbi = parseAbi(["function policyId(bytes32 policyScope) view returns (uint64)", "function pausedFeatures() view returns (uint8[])"]);
const registryAbi = parseAbi(["function isAuthorized(uint64 policyId, address account) view returns (bool)"]);

export type B20GuardResult = {
  ok: boolean;
  /** one line per problem, e.g. "NVDAc: executor policy 7 does not authorize the KyberSwap router" */
  problems: string[];
  /** policy id per scope, by stock (for the record) */
  policies: Record<string, { sender: string; receiver: string; executor: string }>;
};

export async function checkB20Transfers(client: MulticallClient): Promise<B20GuardResult> {
  const stocks = BASE_TOKENIZED_STOCKS;
  const scopeNames = Object.keys(SCOPES) as (keyof typeof SCOPES)[];
  const reads = await client.multicall({
    allowFailure: true,
    contracts: stocks.flatMap((s) => [
      ...scopeNames.map((k) => ({ address: s.b20Address as `0x${string}`, abi: tokenAbi, functionName: "policyId" as const, args: [SCOPES[k]] as const })),
      { address: s.b20Address as `0x${string}`, abi: tokenAbi, functionName: "pausedFeatures" as const },
    ]),
  });

  const problems: string[] = [];
  const policies: B20GuardResult["policies"] = {};
  const per = scopeNames.length + 1;
  stocks.forEach((s, i) => {
    const r = reads.slice(i * per, (i + 1) * per);
    if (r.some((x) => x.status !== "success")) {
      problems.push(`${s.symbol}: could not read its transfer rules`);
      return;
    }
    const [sender, receiver, executor] = r.slice(0, 3).map((x) => String(x.result));
    policies[s.symbol] = { sender, receiver, executor };
    const paused = (r[3].result as readonly number[]).map(Number);
    if (paused.includes(TRANSFER_FEATURE)) problems.push(`${s.symbol}: transfers are paused by the issuer`);
  });

  // Each distinct policy id once: must let an ordinary address, the router and the v4 PoolManager through
  const ids = [...new Set(Object.values(policies).flatMap((p) => [p.sender, p.receiver, p.executor]))];
  const who = [
    { name: "an ordinary address", addr: ORDINARY },
    { name: "the KyberSwap router", addr: KYBER_ROUTER },
    { name: "the Uniswap v4 PoolManager", addr: V4_POOL_MANAGER },
  ];
  const auth = await client.multicall({
    allowFailure: true,
    contracts: ids.flatMap((id) => who.map((w) => ({ address: POLICY_REGISTRY, abi: registryAbi, functionName: "isAuthorized" as const, args: [BigInt(id), w.addr] as const }))),
  });
  const refused = new Map<string, string[]>(); // policy id -> who it refuses
  ids.forEach((id, i) => {
    who.forEach((w, j) => {
      const a = auth[i * who.length + j];
      if (a.status !== "success") refused.set(id, [...(refused.get(id) ?? []), `${w.name} (unreadable)`]);
      else if (a.result !== true) refused.set(id, [...(refused.get(id) ?? []), w.name]);
    });
  });
  for (const [sym, p] of Object.entries(policies)) {
    for (const scope of scopeNames) {
      const no = refused.get(p[scope]);
      if (no?.length) problems.push(`${sym}: ${scope} policy ${p[scope]} does not authorize ${no.join(", ")}`);
    }
  }
  return { ok: problems.length === 0, problems, policies };
}
