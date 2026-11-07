"use client";

/**
 * Extra wallet connectors for users without a browser extension (e.g. mobile browsers):
 *  - Coinbase Smart Wallet: passkey wallet in a popup (keys.coinbase.com), supports EIP-5792 batching.
 *  - WalletConnect: QR code / deep link to MetaMask, Trust, Rainbow, and other mobile wallets.
 * Both SDKs are loaded lazily on click, so they don't slow down the first page load.
 */

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void> | void;
}

export type ExternalWalletKind = "coinbase" | "walletconnect";

const BASE_CHAIN_ID = 8453;
const APP_NAME = "MAXXAGENT";
const PUBLIC_BASE_RPC = "https://mainnet.base.org";

let coinbaseProvider: Eip1193Provider | null = null;
let walletConnectProvider: Eip1193Provider | null = null;

function origin() {
  return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
}

export async function getCoinbaseSmartWallet(): Promise<Eip1193Provider> {
  if (coinbaseProvider) return coinbaseProvider;
  const { createCoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");
  const sdk = createCoinbaseWalletSDK({
    appName: APP_NAME,
    appLogoUrl: `${origin()}/brand/maxxagent-mark-512.png`,
    appChainIds: [BASE_CHAIN_ID],
    // "all": Coinbase Wallet app/extension if present, otherwise the Smart Wallet popup
    preference: { options: "all" },
  });
  coinbaseProvider = sdk.getProvider() as unknown as Eip1193Provider;
  return coinbaseProvider;
}

export function walletConnectConfigured(): boolean {
  return /^[0-9a-f]{32}$/i.test(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "");
}

type WalletConnectProvider = Awaited<ReturnType<typeof import("@walletconnect/ethereum-provider").EthereumProvider.init>>;
let wcInit: Promise<WalletConnectProvider> | null = null;

/** Creates the WalletConnect provider once. It restores a stored session by itself; it does not open the modal. */
function initWalletConnect(): Promise<WalletConnectProvider> {
  if (!wcInit) {
    wcInit = import("@walletconnect/ethereum-provider")
      .then(({ EthereumProvider }) =>
        EthereumProvider.init({
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
          optionalChains: [BASE_CHAIN_ID],
          showQrModal: true,
          optionalMethods: [
            "eth_sendTransaction",
            "eth_chainId",
            "eth_accounts",
            "eth_requestAccounts",
            "wallet_switchEthereumChain",
            "wallet_sendCalls",
            "wallet_getCallsStatus",
            "wallet_getCapabilities",
          ],
          rpcMap: { [BASE_CHAIN_ID]: PUBLIC_BASE_RPC },
          metadata: {
            name: APP_NAME,
            description: "Agent-picked baskets of Coinbase tokenized stocks on Base",
            url: origin(),
            icons: [`${origin()}/brand/maxxagent-mark-512.png`],
          },
        })
      )
      .catch((e) => {
        wcInit = null; // allow a retry
        throw e;
      });
  }
  return wcInit;
}

export async function getWalletConnect(): Promise<Eip1193Provider> {
  if (!walletConnectConfigured()) throw new Error("WalletConnect is not configured.");
  if (walletConnectProvider) return walletConnectProvider;
  const provider = await initWalletConnect();
  if (!provider.session) await provider.enable(); // opens the QR / wallet-list modal
  walletConnectProvider = provider as unknown as Eip1193Provider;
  return walletConnectProvider;
}

export async function connectExternalWallet(kind: ExternalWalletKind): Promise<Eip1193Provider> {
  return kind === "coinbase" ? getCoinbaseSmartWallet() : getWalletConnect();
}

/**
 * Silent reconnect after a page refresh: returns the provider only if the SDK still has a session,
 * WITHOUT opening any popup or QR modal. Returns null when the user has to connect again.
 */
export async function restoreExternalWallet(kind: ExternalWalletKind): Promise<Eip1193Provider | null> {
  try {
    if (kind === "coinbase") {
      const provider = await getCoinbaseSmartWallet();
      // eth_accounts never prompts: [] when the SDK has no stored session
      const accounts = (await provider.request({ method: "eth_accounts" })) as string[];
      return accounts?.[0] ? provider : null;
    }
    if (!walletConnectConfigured()) return null;
    const provider = await initWalletConnect();
    if (!provider.session || !(provider.accounts?.length > 0)) return null;
    walletConnectProvider = provider as unknown as Eip1193Provider;
    return walletConnectProvider;
  } catch {
    return null;
  }
}

/** Ends an external session (WalletConnect / Coinbase). Injected wallets can't be disconnected by the dapp. */
export async function disconnectExternalWallets() {
  try {
    await walletConnectProvider?.disconnect?.();
  } catch {}
  try {
    await coinbaseProvider?.disconnect?.();
  } catch {}
  walletConnectProvider = null;
  coinbaseProvider = null;
}
