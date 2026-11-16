/**
 * ERC-8004 (Trustless Agents) registration file for MAXXAGENT, served at /agent-registration.json (the agentURI)
 * and at /.well-known/agent-registration.json (proof that maxxagent.xyz controls the endpoint).
 * Spec: https://eips.ethereum.org/EIPS/eip-8004 · Identity Registry on Base: 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
 * Only live features are described. AGENT_ID is filled in once the registration transaction has minted it.
 */
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");
export const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
/** agentId minted by the Identity Registry on Base (null until registered) */
export const AGENT_ID: number | null = null;

export function agentRegistration() {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "MAXXAGENT",
    description:
      "Rule-based research agent for Coinbase tokenized stocks on Base. It turns a plain-English request into a basket of " +
      "tokenized stocks using Chainlink NAV, SEC filings and Base DEX liquidity, shows every step with its source, keeps the " +
      "user's limits and says what it won't do. Users review and sign every trade from their own wallet (non-custodial). " +
      "Available only in eligible jurisdictions outside the United States. Not financial advice.",
    image: `${SITE}/brand/maxxagent-mark-512.png`,
    services: [{ name: "web", endpoint: SITE }],
    x402Support: false,
    active: true,
    registrations: AGENT_ID === null ? [] : [{ agentId: AGENT_ID, agentRegistry: `eip155:8453:${IDENTITY_REGISTRY}` }],
    supportedTrust: [],
  };
}
