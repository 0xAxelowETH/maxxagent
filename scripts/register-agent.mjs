// Registers MAXXAGENT in the ERC-8004 Identity Registry on Base mainnet (one-time).
// Reads the team wallet key from .env.local (DEPLOYER_PRIVATE_KEY), never prints it.
// Usage: node scripts/register-agent.mjs            (dry run: checks wallet, card and gas)
//        node scripts/register-agent.mjs --execute  (sends the transaction)
import { existsSync, readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const AGENT_URI = "https://maxxagent.xyz/agent-registration.json";
const EXPECTED_OWNER = "0xD986C711F575C71dA22Bd08742b9DB2091Ba9e33";

const env = {};
const envFile = new URL("../.env.local", import.meta.url);
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const key = env.DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY missing in .env.local or environment");
const account = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
if (account.address.toLowerCase() !== EXPECTED_OWNER.toLowerCase()) throw new Error(`Key is for ${account.address}, expected the team wallet`);

const rpc = env.BASE_RPC_URL || process.env.BASE_RPC_URL || "https://mainnet.base.org";
const pub = createPublicClient({ chain: base, transport: http(rpc) });
const abi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

const card = await fetch(AGENT_URI).then((r) => (r.ok ? r.json() : null));
if (!card || card.name !== "MAXXAGENT") throw new Error("Agent card is not live at " + AGENT_URI);
const gas = await pub.estimateContractGas({ account, address: REGISTRY, abi, functionName: "register", args: [AGENT_URI] });
const bal = await pub.getBalance({ address: account.address });
console.log(`wallet ${account.address.slice(0, 6)}…${account.address.slice(-4)} · ETH ${(Number(bal) / 1e18).toFixed(6)} · gas ${gas}`);

if (!process.argv.includes("--execute")) {
  console.log("dry run OK (add --execute to send)");
  process.exit(0);
}
const wallet = createWalletClient({ account, chain: base, transport: http(rpc) });
const hash = await wallet.writeContract({ address: REGISTRY, abi, functionName: "register", args: [AGENT_URI] });
console.log("tx", hash);
const rcpt = await pub.waitForTransactionReceipt({ hash });
const ev = parseEventLogs({ abi, logs: rcpt.logs, eventName: "Registered" })[0];
console.log("status", rcpt.status, "· agentId", ev?.args.agentId?.toString());
