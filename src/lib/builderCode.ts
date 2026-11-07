import { Attribution } from "ox/erc8021";

/**
 * Official ERC-8021 Base Builder Codes Implementation powered by `ox/erc8021`
 * Reference: https://docs.base.org/builder-codes & https://erc8021.com
 *
 * Why this matters for Base Stocks Maxxing:
 * 50% of the judging score is "Traction: real usage, verified onchain".
 * Base uses ERC-8021 backward-parsed calldata suffixes (`dataSuffix`) to attribute
 * onchain transactions, volume, and user retention to your registered Project Builder Code.
 */

export interface BuilderCodeAttribution {
  codes: string[];
  schemaId: number;
  dataSuffix: `0x${string}`;
  byteLength: number;
}

/**
 * Generates a standard-compliant ERC-8021 `dataSuffix` using the official `ox/erc8021` library.
 */
export function toErc8021DataSuffix(codes: string[]): BuilderCodeAttribution {
  const sanitizedCodes = codes
    .map((c) => c.trim().replace(/[^a-zA-Z0-9_-]/g, ""))
    .filter(Boolean);

  const effectiveCodes = sanitizedCodes.length > 0 ? sanitizedCodes : ["bc_ewm6gcvz"];

  // Official `ox/erc8021` Attribution.toDataSuffix
  const dataSuffix = Attribution.toDataSuffix({
    codes: effectiveCodes,
  }) as `0x${string}`;

  const byteLength = (dataSuffix.length - 2) / 2;

  return {
    codes: effectiveCodes,
    schemaId: 0,
    dataSuffix,
    byteLength,
  };
}

/**
 * Appends an ERC-8021 Builder Code suffix onto existing transaction calldata (`0x...`).
 */
export function appendBuilderCodeToCalldata(
  calldata: `0x${string}`,
  builderCode: string | string[]
): `0x${string}` {
  const codes = Array.isArray(builderCode) ? builderCode : [builderCode];
  const { dataSuffix } = toErc8021DataSuffix(codes);
  const cleanCalldata = calldata.startsWith("0x") ? calldata : (`0x${calldata}` as `0x${string}`);
  return `${cleanCalldata}${dataSuffix.slice(2)}` as `0x${string}`;
}

/**
 * Parses and verifies an ERC-8021 Builder Code suffix from raw transaction calldata
 * using official `ox/erc8021` `Attribution.fromData`.
 */
export function parseErc8021Calldata(calldata: string): {
  isValid: boolean;
  codes: string[];
  schemaId: number | null;
  rawSuffix: string | null;
} {
  try {
    const formatted = (calldata.startsWith("0x") ? calldata : `0x${calldata}`) as `0x${string}`;
    const parsed = Attribution.fromData(formatted);
    if (!parsed || !parsed.codes || parsed.codes.length === 0) {
      return { isValid: false, codes: [], schemaId: null, rawSuffix: null };
    }
    const { dataSuffix } = toErc8021DataSuffix([...parsed.codes]);
    return {
      isValid: true,
      codes: [...parsed.codes],
      schemaId: parsed.id ?? 0,
      rawSuffix: dataSuffix,
    };
  } catch {
    return { isValid: false, codes: [], schemaId: null, rawSuffix: null };
  }
}

/**
 * Appends an ERC-8021 suffix with zero padding BEFORE it, so the result is a multiple of 32 bytes.
 * Batching wallets (EIP-7702 `execute`, ERC-4337 `executeBatch`) ABI-encode each call's data and pad it
 * to 32 bytes; padding after the suffix hides it from indexers, which read from the very end of the
 * input. With aligned data there is no padding, so the wallet's outer calldata ends with our suffix.
 * Only use on calls whose target ignores trailing calldata (e.g. the swap router).
 */
export function alignedWithSuffix(calldata: string, suffix: string): `0x${string}` {
  const body = calldata.replace(/^0x/, "");
  const sfx = suffix.replace(/^0x/, "");
  const pad = (32 - ((body.length / 2 + sfx.length / 2) % 32)) % 32;
  return `0x${body}${"00".repeat(pad)}${sfx}`;
}
