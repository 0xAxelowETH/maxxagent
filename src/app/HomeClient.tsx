"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Activity,
  BarChart3,
  Bot,
  CircleHelp,
  Code2,
  Puzzle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  ExternalLink,
  FileText,
  Coins,
  Flame,
  Layers,
  LogOut,
  Newspaper,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Zap,
} from "lucide-react";
import {
  B20DividendSplitSimulator,
  GuidedQuickStartBar,
  InteractiveB20TradingChart,
  type OnchainActivityEntry,
  PlainEnglishGlossaryStrip,
} from "@/components/StockMaxxUxWidgets";
import {
  BASE_TOKENIZED_STOCKS,
  LiveTokenizedStock,
  PROGRAMMABLE_INDEX_PRESETS,
  MIN_BUY_USD,
  ProgrammableIndexPreset,
} from "@/lib/tokenizedStocks";
import { AgentAnalysisReport } from "@/lib/agentEngine";
import { INDEX_REGISTRY_ABI } from "@/lib/contracts/StockMaxxIndexRegistryABI";
import { decodeErrorResult, encodeFunctionData } from "viem";
import {
  normalizeChainHex,
  prepareBuy,
  prepareSell,
  sendContractCall,
  submitOrder,
  QUOTE_TTL_MS,
  BasketLeg,
  BasketResult,
  PreparedOrder,
  SellLeg,
  type WalletHint,
} from "@/lib/basketExecutor";
import { MaxxAgentLogo, MaxxAgentMark } from "@/components/BrandLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { OrderReview } from "@/components/OrderReview";
import { type TradeHistoryEntry } from "@/components/TradeHistoryPanel";
import { MarketStatus } from "@/components/MarketStatus";
import { usMarketStatus } from "@/lib/marketHours";
import { detectMiniApp } from "@/lib/miniApp";
import { MarketHeatmap } from "@/components/MarketHeatmap";
import { alertPctOf, computeDrift, driftSummary, parseSavedTarget, type RebalanceLogEntry, type SavedTarget } from "@/lib/drift";
import { capPromptSteps, roundWeightsBps } from "@/lib/weights";
import { TermsGate, TERMS_STORAGE_KEY } from "@/components/TermsGate";
import { UsdAmountInput } from "@/components/UsdAmountInput";
import { basketToQuery, cleanIndexName, parseSharedBasket } from "@/lib/shareBasket";
import {
  connectExternalWallet,
  disconnectExternalWallets,
  restoreExternalWallet,
  walletConnectConfigured,
  ExternalWalletKind,
} from "@/lib/walletConnectors";

const TabLoading = () => (
  <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-8 text-center text-xs text-slate-400">
    Loading…
  </div>
);

const AgentTab = dynamic(() => import("@/components/tabs/AgentTab"), { loading: TabLoading });
const IndexesTab = dynamic(() => import("@/components/tabs/IndexesTab"), { loading: TabLoading });
const PortfolioTab = dynamic(() => import("@/components/tabs/PortfolioTab"), { loading: TabLoading });
const PublicAttributionTab = dynamic(() => import("@/components/tabs/PublicAttributionTab"), { loading: TabLoading });
const NewsFeed = dynamic(() => import("@/components/NewsFeed").then((m) => m.NewsFeed), { loading: TabLoading });
const PairedForStock = dynamic(() => import("@/components/PairedForStock").then((m) => m.PairedForStock), { ssr: false });
const PairedTab = dynamic(() => import("@/components/tabs/PairedTab"), { loading: TabLoading });

type ActiveTab = "terminal" | "agent" | "indexes" | "news" | "paired" | "traction" | "public";
// App sections, shared by the wide-screen sidebar and the tab bar below the header
const SECTION_TABS: { id: ActiveTab; label: string; icon: typeof TrendingUp; badge: string }[] = [
  { id: "terminal", label: "Market", icon: TrendingUp, badge: "10 stocks" },
  { id: "agent", label: "Agent", icon: Bot, badge: "Agentic" },
  { id: "indexes", label: "Indexes", icon: Layers, badge: "Onchain" },
  { id: "news", label: "News", icon: Newspaper, badge: "Live" },
  { id: "paired", label: "Paired", icon: Coins, badge: "Meme" },
  { id: "traction", label: "Portfolio", icon: Zap, badge: "Yours" },
  { id: "public", label: "Studio", icon: Flame, badge: "Team" },
];
// Pages outside the app: guides, proofs and terms
const RESOURCE_LINKS: { href: string; label: string; icon: typeof TrendingUp; isNew?: boolean }[] = [
  { href: "/bankr", label: "Bankr skill", icon: Puzzle, isNew: true },
  { href: "/verify", label: "Verify", icon: ShieldCheck },
  { href: "/stats", label: "Live stats", icon: BarChart3 },
  { href: "/status", label: "Status", icon: Activity },
  { href: "/faq", label: "FAQ", icon: CircleHelp },
  { href: "/terms", label: "Terms", icon: FileText },
];
// Tab <-> URL (?tab=…): shareable links, and the browser's Back button goes to the previous tab
const SLUG_BY_TAB: Partial<Record<ActiveTab, string>> = { agent: "agent", indexes: "indexes", news: "news", paired: "paired", traction: "portfolio" };
const TAB_BY_SLUG: Record<string, ActiveTab> = { market: "terminal", agent: "agent", indexes: "indexes", news: "news", paired: "paired", portfolio: "traction" };

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

/** EIP-6963 multi-wallet discovery */
interface Eip6963ProviderDetail {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EthereumProvider;
}

type WindowWithWallets = {
  ethereum?: EthereumProvider;
  binancew3w?: { ethereum?: EthereumProvider };
  okxwallet?: EthereumProvider;
  bitkeep?: { ethereum?: EthereumProvider };
};

function getInjectedFallback(): EthereumProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as WindowWithWallets;
  return w.binancew3w?.ethereum ?? w.okxwallet ?? w.bitkeep?.ethereum ?? w.ethereum ?? null;
}

function detectInjectedName(eth: EthereumProvider | null): string {
  if (!eth || typeof window === "undefined") return "Browser wallet";
  const w = window as unknown as WindowWithWallets;
  const p = eth as unknown as Record<string, unknown>;
  if (p.isBinance || p.isBinanceWeb3 || eth === w.binancew3w?.ethereum) return "Binance Web3 Wallet";
  if (p.isOkxWallet || p.isOKExWallet || eth === w.okxwallet) return "OKX Wallet";
  if (p.isBitKeep || p.isBitgetWallet || eth === w.bitkeep?.ethereum) return "Bitget Wallet";
  if (p.isZerion) return "Zerion";
  if (p.isRainbow) return "Rainbow";
  return "Browser wallet";
}

function hasErrorCode(err: unknown, targetCode: number, depth = 0): boolean {
  if (!err || typeof err !== "object" || depth > 4) return false;
  const e = err as Record<string, unknown>;
  if (e.code === targetCode) return true;
  return (
    hasErrorCode(e.data, targetCode, depth + 1) ||
    hasErrorCode(e.originalError, targetCode, depth + 1) ||
    hasErrorCode(e.cause, targetCode, depth + 1)
  );
}

function isMissingChainError(err: unknown): boolean {
  if (hasErrorCode(err, 4902)) return true;
  const msg = err instanceof Error ? err.message : String((err as { message?: unknown })?.message ?? err ?? "");
  return /unrecognized chain|unknown chain|chain .*not.*added|missing.*chain|4902/i.test(msg);
}

const BASE_MAINNET_PARAMS = {
  chainId: "0x2105",
  chainName: "Base Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://mainnet.base.org"],
  blockExplorerUrls: ["https://basescan.org"],
};

async function switchOrAddBaseChain(eth: EthereumProvider): Promise<string> {
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_MAINNET_PARAMS.chainId }],
    });
  } catch (switchErr: unknown) {
    if (!isMissingChainError(switchErr)) throw switchErr;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [BASE_MAINNET_PARAMS],
    });
  }
  const actualRaw = await eth.request({ method: "eth_chainId" }).catch(() => "");
  const actualHex = normalizeChainHex(actualRaw);
  if (actualHex !== BASE_MAINNET_PARAMS.chainId) {
    throw new Error(
      actualHex
        ? "Please switch your wallet network to Base Mainnet (8453) and try again."
        : "Could not verify your wallet network. Make sure your wallet is on Base Mainnet (8453) and try again."
    );
  }
  return actualHex;
}

function withRpcTimeout<T>(promise: Promise<T>, ms = 10_000, label = "RPC request timed out"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function extractRevertData(err: unknown, depth = 0): string {
  if (!err || typeof err !== "object" || depth > 4) return "";
  const e = err as Record<string, unknown>;
  if (typeof e.data === "string" && /^0x[0-9a-fA-F]{8}/.test(e.data)) return e.data;
  for (const nested of [e.data, e.originalError, e.cause]) {
    const hit = extractRevertData(nested, depth + 1);
    if (hit) return hit;
  }
  return "";
}

function useDismissMenu(open: boolean, ref: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

/**
 * 7-day sparkline from real Chainlink NAV rounds
 */
function StockSparkline({ color, symbol }: { color: string; symbol: string }) {
  // Real 7-day Chainlink NAV rounds (onchain); nothing synthesized
  const [series, setSeries] = useState<[number, number][]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?symbol=${symbol}&tf=7D&only=nav`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) {
          const nav: [number, number][] = Array.isArray(d?.nav) ? d.nav : [];
          setSeries(nav);
          setFailed(nav.length < 2);
        }
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const width = 150;
  const height = 40;
  if (series.length < 2) {
    return (
      <div className="h-11 flex items-center justify-center text-[10px] text-slate-500">
        {failed ? "7D history unavailable" : "Loading 7D NAV…"}
      </div>
    );
  }
  const t0 = series[0][0];
  const t1 = series[series.length - 1][0];
  const vMin = Math.min(...series.map((p) => p[1]));
  const vMax = Math.max(...series.map((p) => p[1]));
  const px = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * width;
  const py = (v: number) => 4 + (1 - (v - vMin) / Math.max(1e-9, vMax - vMin)) * (height - 8);
  const lineCoords = series.map(([t, v]) => `${px(t).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const areaCoords = `0,${height} ${lineCoords} ${width},${height}`;
  const last = series[series.length - 1];
  const gradId = `spark-grad-${symbol}`;
  const pts = [py(last[1])];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-11 overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.42" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={areaCoords} fill={`url(#${gradId})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={lineCoords}
      />
      <circle
        cx={width}
        cy={pts[pts.length - 1]}
        r="3.2"
        fill={color}
        className="animate-pulse"
      />
    </svg>
  );
}

const errMsg = (err: unknown, fallback: string): string => {
  if (!err) return fallback;
  if (typeof err === "string" && err.trim()) return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    for (const candidate of [
      e.shortMessage,
      e.message,
      (e.data as Record<string, unknown> | undefined)?.originalError &&
        ((e.data as Record<string, unknown>).originalError as Record<string, unknown>).message,
      (e.data as Record<string, unknown> | undefined)?.message,
      (e.cause as Record<string, unknown> | undefined)?.message,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }
  return fallback;
};

// Oracle age for compact cells: 12m / 17h / 2d
const fmtAge = (m: number) =>
  !Number.isFinite(m) || m < 0 ? "stale" : m < 60 ? `${Math.round(m)}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;

const SLIPPAGE_OPTIONS = [30, 50, 100];

// Shareable basket links: /?basket=NVDAc-40,MSFTc-30&amount=50 (parsing in lib/shareBasket)
const PUBLIC_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");

export default function StockMaxxingDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("terminal");
  // Keep ?tab= in the address bar in step with the open tab (a new history entry per switch), and follow Back/Forward
  const tabUrlReady = useRef(false);
  useEffect(() => {
    if (!tabUrlReady.current) return;
    const url = new URL(window.location.href);
    const slug = SLUG_BY_TAB[activeTab] ?? "";
    if ((url.searchParams.get("tab") ?? "") === slug) return;
    if (slug) url.searchParams.set("tab", slug);
    else url.searchParams.delete("tab");
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }, [activeTab]);
  useEffect(() => {
    const onPop = () => setActiveTab(TAB_BY_SLUG[new URLSearchParams(window.location.search).get("tab") ?? ""] ?? "terminal");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Hidden team studio (build-in-public tools): open with ?studio in the URL
  const [studioMode, setStudioMode] = useState<boolean>(false);
  useEffect(() => {
    try {
      setStudioMode(new URLSearchParams(window.location.search).has("studio"));
    } catch {}
  }, []);

  // EIP-6963: discover every installed wallet instead of trusting window.ethereum
  const [walletProviders, setWalletProviders] = useState<Eip6963ProviderDetail[]>([]);
  const [showWalletMenu, setShowWalletMenu] = useState<boolean>(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  // Connected-wallet dropdown (copy address, BaseScan, switch, disconnect)
  const [accountMenuOpen, setAccountMenuOpen] = useState<boolean>(false);
  const [addressCopied, setAddressCopied] = useState<boolean>(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const closeAccountMenu = useCallback(() => setAccountMenuOpen(false), []);
  const closeWalletMenu = useCallback(() => setShowWalletMenu(false), []);
  useDismissMenu(accountMenuOpen, accountMenuRef, closeAccountMenu);
  useDismissMenu(showWalletMenu, walletMenuRef, closeWalletMenu);
  const [connectedWalletName, setConnectedWalletName] = useState<string>("");
  const [connectingWallet, setConnectingWallet] = useState<boolean>(false);
  const connectingWalletRef = useRef(false);
  const inMiniAppRef = useRef(false);
  const providerRef = useRef<EthereumProvider | null>(null);
  const walletMetaRef = useRef<WalletHint | undefined>(undefined);
  const detachListenersRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      setWalletProviders((prev) => (prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Mobile WebViews often inject their EIP-6963 listener asynchronously after first paint
    const retryTimer = window.setTimeout(() => {
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    }, 400);
    return () => {
      window.clearTimeout(retryTimer);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
    };
  }, []);
  useEffect(() => {
    if (!showWalletMenu) return;
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Pre-warm Coinbase SDK chunk while the menu is open so Safari click preserves user activation for window.open
    void import("@coinbase/wallet-sdk").catch(() => {});
  }, [showWalletMenu]);
  const getEthProvider = useCallback((): EthereumProvider | null => {
    return providerRef.current ?? getInjectedFallback();
  }, []);
  /** The account that will actually sign. Swaps send tokens to this address, so never use a stale one. */
  const resolveSender = useCallback(async (eth: EthereumProvider): Promise<string> => {
    let accounts = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
    if (!accounts?.[0]) accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
    const active = accounts?.[0];
    if (!active) throw new Error("No wallet account available. Connect your wallet first.");
    return active;
  }, []);

  // Bumped after a purchase so balances refresh
  const [balanceRefreshNonce, setBalanceRefreshNonce] = useState<number>(0);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [ethBalance, setEthBalance] = useState<number | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [stocks, setStocks] = useState<LiveTokenizedStock[]>([]);
  const [totalTvlUsd, setTotalTvlUsd] = useState<number>(0);
  const [totalDexLiquidityUsd, setTotalDexLiquidityUsd] = useState<number>(0);
  const [totalDexVolume24hUsd, setTotalDexVolume24hUsd] = useState<number>(0);
  const [fetchedAt, setFetchedAt] = useState<string>("");
  const [loadingStocks, setLoadingStocks] = useState<boolean>(true);
  // Wallet whose balances are currently shown (lowercase); "" = none loaded yet
  const [balancesFor, setBalancesFor] = useState<string>("");
  const [balancesError, setBalancesError] = useState<string>("");
  // Max slippage for swaps (bps), chosen in the review screen and remembered per browser
  const [slippageBps, setSlippageBps] = useState<number>(50);
  const slippageRef = useRef<number>(50);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem("maxxagent_slippage_bps"));
      if (SLIPPAGE_OPTIONS.includes(v)) {
        slippageRef.current = v;
        setSlippageBps(v);
      }
    } catch {}
  }, []);
  // P/L rebuilt from the wallet's onchain history (/api/pnl). Loads after balances and never blocks them.
  const [pnl, setPnl] = useState<{
    for: string;
    error: string;
    data: {
      since: string | null;
      complete: boolean;
      realizedUsd: number;
      positions: { symbol: string; avgCostUsd: number | null; realizedUsd: number; estimated: boolean }[];
      activity?: TradeHistoryEntry[];
    } | null;
  }>({ for: "", error: "", data: null });

  // Wallet & Builder Code State
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [chainIdHex, setChainIdHex] = useState<string>("");
  const [walletBalances, setWalletBalances] = useState<
    Record<string, { rawTokens: number; sharesUI: number; usdValue: number; b20Authorized?: boolean }>
  >({});
  // The project's Builder Code is fixed (attribution must always go to MAXXAGENT)
  const builderCode = process.env.NEXT_PUBLIC_BASE_BUILDER_CODE || "bc_ewm6gcvz";
  const registryAddress = process.env.NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS || "";
  const hasRegistry = /^0x[a-fA-F0-9]{40}$/.test(registryAddress);
  // First-visit terms gate (explicit, never pre-checked). null = not yet read from storage.
  const [termsAccepted, setTermsAccepted] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setTermsAccepted(Boolean(localStorage.getItem(TERMS_STORAGE_KEY)));
    } catch {
      setTermsAccepted(false);
    }
  }, []);
  const nonUsComplianceAccepted = termsAccepted === true;
  // Studio raw calldata toggle + Market workspace view + Table Search/Sort/Filters + Agent Bar Hover
  const [proMode, setProMode] = useState<boolean>(false);
  const [marketView, setMarketView] = useState<"overview" | "terminal">("overview");
  const [tableSort, setTableSort] = useState<{
    col: "default" | "nav" | "change" | "gap" | "mult" | "vol" | "mcap";
    dir: "desc" | "asc";
  }>({ col: "default", dir: "desc" });
  const [highlightedAlloc, setHighlightedAlloc] = useState<string | null>(null);
  const [chartSelectedSymbol, setChartSelectedSymbol] = useState<string>("NVDAc");
  // Stock the Paired tab opens filtered to ("See all" under a stock's chart)
  const [pairedFilter, setPairedFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>("ALL");
  const [selectedSignalFilter, setSelectedSignalFilter] = useState<string>("ALL");
  const [openSourcesMenu, setOpenSourcesMenu] = useState<{
    symbol: string;
    right: number;
    top: number;
    bottom: number;
    upward: boolean;
  } | null>(null);
  const attachTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const txPendingRef = useRef<boolean>(false);

  const scrollWhenReady = useCallback((selector: string, block: ScrollLogicalPosition = "start") => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = null;
    }
    let attempts = 0;
    const poll = () => {
      const el = document.querySelector(selector);
      if (el) {
        scrollTimerRef.current = null;
        requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block }));
        return;
      }
      if (++attempts < 40) scrollTimerRef.current = setTimeout(poll, 100);
      else scrollTimerRef.current = null;
    };
    poll();
  }, []);

  useEffect(() => {
    if (!openSourcesMenu) return;
    const close = () => setOpenSourcesMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [openSourcesMenu]);

  useEffect(() => {
    return () => {
      if (attachTimerRef.current) clearTimeout(attachTimerRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      detachListenersRef.current?.();
    };
  }, []);

  // AI Agent State
  const [userPrompt, setUserPrompt] = useState<string>(
    "AI and cloud compute leaders (NVDAc, MSFTc, GOOGLc, SNDKc), prefer stocks trading below NAV"
  );
  const [mandateHistory, setMandateHistory] = useState<string[]>([]);
  const mandateHistoryRef = useRef<string[]>([]);
  const [followUpPrompt, setFollowUpPrompt] = useState<string>("");
  const [demoPortfolio, setDemoPortfolio] = useState<boolean>(false);
  const [demoActionMsg, setDemoActionMsg] = useState<string>("");
  useEffect(() => {
    if (walletAddress) {
      setDemoPortfolio(false);
      setDemoActionMsg("");
    }
  }, [walletAddress]);
  const [studioDay, setStudioDay] = useState<number>(1);
  const [studioMilestone, setStudioMilestone] = useState<string>(
    "Shipped live Chainlink NAV vs DEX price tracking for the 10 Coinbase tokenized stocks MAXXAGENT supports on Base"
  );
  const [riskProfile, setRiskProfile] = useState<"Conservative" | "Balanced" | "Aggressive">(
    "Balanced"
  );
  const [capitalUsd, setCapitalUsd] = useState<number>(20);
  // Single-stock trade amount (Swap panel), separate from the basket capital in the Agent tab
  const [tradeUsd, setTradeUsd] = useState<number>(10);
  const [agentReport, setAgentReport] = useState<AgentAnalysisReport | null>(null);
  const agentReportPromptRef = useRef<string>("");
  agentReportPromptRef.current = agentReport?.userPrompt || "";
  const [heroPrompt, setHeroPrompt] = useState<string>("");
  // The hero's Ask button waits for hydration: a submit before it would reload the page instead of asking
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  // The basket this wallet wants to hold (saved in this browser, per wallet). The agent checks the wallet against it on every visit.
  const [savedTarget, setSavedTarget] = useState<SavedTarget | null>(null);
  const [runningAgent, setRunningAgent] = useState<boolean>(false);
  const [agentError, setAgentError] = useState<string>("");

  // Programmable Index Builder State
  const [selectedPreset, setSelectedPreset] = useState<ProgrammableIndexPreset>(
    PROGRAMMABLE_INDEX_PRESETS[0]
  );
  const [customIndexName, setCustomIndexName] = useState<string>("My AI Basket");
  const [customIndexTicker, setCustomIndexTicker] = useState<string>("MAXX-10");
  const [customWeights, setCustomWeights] = useState<Record<string, number>>({
    NVDAc: 2800,
    SPCXc: 2000,
    TSLAc: 1800,
    MSFTc: 1800,
    AAPLc: 1600,
  });
  const [builderView, setBuilderView] = useState<"selected-first" | "selected-only" | "all">("selected-first");
  const [builderPinned, setBuilderPinned] = useState<string[]>(() => ["NVDAc", "SPCXc", "TSLAc", "MSFTc", "AAPLc"]);

  // Onchain Tx & Copy Feedback State
  const [txHash, setTxHash] = useState<string>("");
  const [txError, setTxError] = useState<string>("");
  const [txPending, setTxPending] = useState<boolean>(false);
  const [publishStatus, setPublishStatus] = useState<string>("");
  const [copiedKey, setCopiedKey] = useState<string>("");
  // Only real transactions sent from this browser are logged (no seeded/example entries)
  const [activityLog, setActivityLog] = useState<OnchainActivityEntry[]>([]);

  // In-app basket buying (USDC -> B20 stocks, non-custodial, ERC-8021 attributed)
  // One amount drives the agent proposal and the purchase
  const basketUsd = capitalUsd;
  const setBasketUsd = setCapitalUsd;
  // How baskets are paid (Agent + Indexes): USDC, or ETH sent with each swap
  const [basketPayWith, setBasketPayWith] = useState<"usdc" | "eth">("usdc");
  const payToggle = (
    <span className="inline-flex rounded-lg border border-slate-700 bg-[#040814] p-0.5 text-[11px]" role="group" aria-label="Pay basket with">
      {(["usdc", "eth"] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setBasketPayWith(t)}
          aria-pressed={basketPayWith === t}
          className={`rounded-md px-2.5 py-1 font-bold uppercase transition cursor-pointer ${
            basketPayWith === t ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
          }`}
        >
          {t}
        </button>
      ))}
    </span>
  );
  const payLabel = basketPayWith === "eth" ? "in ETH" : "USDC";
  const amountControl = (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs text-slate-300">
      Amount
      <span className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">$</span>
        <UsdAmountInput
                            value={basketUsd}
                            onChange={setBasketUsd}
                            min={MIN_BUY_USD}
                            className="w-24 rounded-lg border border-slate-700 bg-[#050811] py-1.5 pl-6 pr-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                            ariaLabel="Basket amount in USD"
                          />
      </span>
      {payToggle}
    </span>
  );
  const [basketPending, setBasketPending] = useState<boolean>(false);
  const [basketStatus, setBasketStatus] = useState<string>("");
  const [basketStep, setBasketStep] = useState<{ step: number; total: number } | null>(null);
  const [basketError, setBasketError] = useState<string>("");
  const [basketResult, setBasketResult] = useState<BasketResult | null>(null);

  const updateBasketStatus = useCallback((msg: string) => {
    setBasketStatus(msg);
    if (!msg) {
      setBasketStep(null);
      return;
    }
    const match = msg.match(/\((\d+)\/(\d+)\)/);
    if (match) {
      const step = Number(match[1]);
      const total = Number(match[2]);
      if (total > 0) setBasketStep({ step: Math.min(step, total), total });
      return;
    }
    if (msg.startsWith("Reading what you received")) {
      setBasketStep((prev) => (prev ? { step: prev.total, total: prev.total } : prev));
    }
  }, []);

  const recordOnchainActivity = useCallback(
    (
      actionLabel: string,
      hashValue: string,
      netLabel: "Base Mainnet (8453)"
    ) => {
      const entry: OnchainActivityEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: actionLabel,
        network: netLabel,
        builderCode,
        txHash: hashValue,
        timestamp: new Date().toLocaleTimeString(),
      };
      setActivityLog((prev) => {
        const updated = [entry, ...prev].slice(0, 20);
        try {
          window.localStorage.setItem("maxxagent_activity_log", JSON.stringify(updated));
        } catch {}
        return updated;
      });
    },
    [builderCode]
  );

  // Order review: quotes are shown to the user before anything is sent to the wallet
  const [review, setReview] = useState<{
    order: PreparedOrder;
    label: string;
    legs: { buy?: BasketLeg[]; sell?: SellLeg[] };
  } | null>(null);
  const [reviewBusy, setReviewBusy] = useState<boolean>(false);

  // Finished rebalance steps of the connected wallet (this browser only), shown under its saved target
  const rebalanceKey = walletAddress ? `maxxagent_rebalances_${walletAddress.toLowerCase()}` : "";
  const [rebalanceLog, setRebalanceLog] = useState<RebalanceLogEntry[]>([]);
  useEffect(() => {
    try {
      const raw = rebalanceKey ? JSON.parse(localStorage.getItem(rebalanceKey) || "[]") : [];
      setRebalanceLog(Array.isArray(raw) ? raw.filter((e) => e && typeof e.at === "string" && Array.isArray(e.txHashes)).slice(0, 20) : []);
    } catch {
      setRebalanceLog([]);
    }
  }, [rebalanceKey]);

  const [rebalanceBuyDoneNonce, setRebalanceBuyDoneNonce] = useState(0);
  const [rebalanceUsdcBaseline, setRebalanceUsdcBaseline] = useState<number | null>(null);
  const usdcBalanceRef = useRef<number | null>(null);
  usdcBalanceRef.current = usdcBalance;
  const recordResult = useCallback(
    (result: BasketResult, label: string, preTxUsdcBalance: number | null = null) => {
      setBasketResult(result);
      if (label === "rebalance" && result.bought.length > 0) {
        if (result.side === "sell" && preTxUsdcBalance !== null) {
          // Only lock USDC baseline after Step 1 Sell actually confirms onchain
          setRebalanceUsdcBaseline((prev) => prev ?? preTxUsdcBalance);
        } else if (result.side === "buy") {
          setRebalanceUsdcBaseline(null);
          setRebalanceBuyDoneNonce((n) => n + 1);
        }
      }
      if (label === "rebalance" && rebalanceKey && result.txHashes.length) {
        const summary =
          result.side === "sell"
            ? result.bought.map((b) => `${(b.amountInTokens ?? 0).toFixed(4)} ${b.symbol}`).join(", ")
            : (result.received.length ? result.received.map((r) => `${r.tokens.toFixed(4)} ${r.symbol}`) : result.bought.map((b) => b.symbol)).join(", ");
        const entry: RebalanceLogEntry = { at: new Date().toISOString(), side: result.side === "sell" ? "sell" : "buy", summary, txHashes: result.txHashes };
        setRebalanceLog((prev) => {
          const next = [entry, ...prev].slice(0, 20);
          try {
            localStorage.setItem(rebalanceKey, JSON.stringify(next));
          } catch {}
          return next;
        });
      }
      setBalanceRefreshNonce((n) => n + 1);
      setTimeout(() => setBalanceRefreshNonce((n) => n + 1), 4000);
      let text: string;
      if (result.side === "buy") {
        const got =
          result.received.length > 0
            ? result.received.map((r) => `${r.tokens.toFixed(6)} ${r.symbol}`).join(", ")
            : result.bought.map((b) => b.symbol).join(", ");
        text = `BUY ${label}: ${got}`;
      } else {
        const usdc = result.received.find((r) => r.symbol === "USDC");
        text = `SELL ${label}: ${result.bought.map((b) => `${(b.amountInTokens ?? 0).toFixed(6)} ${b.symbol}`).join(", ")} → ${
          usdc ? `${usdc.tokens.toFixed(2)} USDC` : "USDC"
        }`;
      }
      result.txHashes.forEach((h) => recordOnchainActivity(text, h, "Base Mainnet (8453)"));
    },
    [recordOnchainActivity, rebalanceKey]
  );

  const targetKey = walletAddress ? `maxxagent_target_${walletAddress.toLowerCase()}` : "";
  useEffect(() => {
    if (!targetKey) return setSavedTarget(null);
    try {
      setSavedTarget(parseSavedTarget(JSON.parse(localStorage.getItem(targetKey) || "null"), BASE_TOKENIZED_STOCKS.map((s) => s.symbol)));
    } catch {
      setSavedTarget(null);
    }
  }, [targetKey]);
  const saveTarget = (t: SavedTarget | null) => {
    setSavedTarget(t);
    if (!targetKey) return;
    try {
      if (t) localStorage.setItem(targetKey, JSON.stringify(t));
      else localStorage.removeItem(targetKey);
    } catch {}
  };
  // Drift of the connected wallet from its saved target (only once this wallet's balances are loaded)
  const targetDrift =
    savedTarget && walletAddress && balancesFor === walletAddress.toLowerCase()
      ? computeDrift(
          Object.entries(walletBalances).map(([symbol, b]) => ({ symbol, usd: b?.usdValue ?? 0 })),
          savedTarget.weights,
          savedTarget.maxWeightPct
        )
      : null;
  const targetReady = Boolean(savedTarget && walletAddress && balancesFor === walletAddress.toLowerCase());
  const targetOff = targetDrift !== null && (targetDrift.driftPct >= alertPctOf(savedTarget) || targetDrift.breaches.length > 0);

  const syncAutoWalletRef = useRef<(eth: EthereumProvider, sender: string, chainId?: unknown) => void>(() => {});
  const orderLockRef = useRef(false);
  const reviewBusyRef = useRef(false);
  // Step 1 (buy): quote one or more B20 stocks and open the review. Nothing is sent yet.
  const buyStocks = useCallback(
    async (legs: BasketLeg[], label: string, typedTotalUsd?: number) => {
      if (orderLockRef.current || txPendingRef.current) return;
      setBasketError("");
      setBasketResult(null);
      if (!nonUsComplianceAccepted) {
        setBasketError("Please accept the terms first (reload the page to see them).");
        return;
      }
      const validLegs = legs.filter((l) => l.usd >= MIN_BUY_USD);
      if (validLegs.length < legs.length) {
        // Never silently drop part of a basket: tell the user the smallest total that funds every stock
        // Scaled to the amount the user typed (which may include USDC kept as cash), plus a cent for the
        // per-leg rounding down, so the hint is never the amount they already entered
        const total = typedTotalUsd && typedTotalUsd > 0 ? typedTotalUsd : legs.reduce((a, l) => a + l.usd, 0);
        const smallest = Math.min(...legs.map((l) => l.usd));
        const needed = smallest > 0 ? Math.ceil(((MIN_BUY_USD + 0.01) * total) / smallest) : 0;
        setBasketError(`Each stock needs at least $${MIN_BUY_USD.toFixed(2)}.${needed > 0 ? ` For this basket, use at least $${needed}.` : ""}`);
        return;
      }
      if (!walletAddress && !inMiniAppRef.current) {
        setShowWalletMenu(true);
        setBasketError("Connect a wallet first to buy on Base.");
        return;
      }
      const eth = getEthProvider();
      if (!eth) {
        setShowWalletMenu(true);
        setBasketError("Connect a wallet first to buy on Base.");
        return;
      }
      orderLockRef.current = true;
      setBasketPending(true);
      let targetSender = "";
      try {
        const sender = await resolveSender(eth);
        targetSender = sender.toLowerCase();
        if (!walletRef.current || targetSender !== walletRef.current) {
          const cid = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
          syncAutoWalletRef.current(eth, sender, cid);
        }
        const order = await prepareBuy({ eth, sender, legs: validLegs, slippageBps: slippageRef.current, onStatus: updateBasketStatus });
        if (walletRef.current !== targetSender) return;
        setChainIdHex("0x2105");
        setReview({ order, label, legs: { buy: validLegs } });
      } catch (err: unknown) {
        if (!targetSender || walletRef.current === targetSender) {
          setBasketError(errMsg(err, "Could not prepare the order"));
        }
      } finally {
        orderLockRef.current = false;
        updateBasketStatus("");
        setBasketPending(false);
      }
    },
    [nonUsComplianceAccepted, walletAddress, getEthProvider, resolveSender, updateBasketStatus]
  );

  // Step 1 (sell): quote the sale and open the review. Nothing is sent yet.
  const sellStocks = useCallback(
    async (legs: SellLeg[], label: string) => {
      if (orderLockRef.current || txPendingRef.current) return;
      setBasketError("");
      setBasketResult(null);
      if (!nonUsComplianceAccepted) {
        setBasketError("Please accept the terms first (reload the page to see them).");
        return;
      }
      const validLegs = legs.filter((l) => l.tokens > 0);
      const eth = getEthProvider();
      if (!eth || !walletAddress) {
        setBasketError("Connect your wallet first.");
        return;
      }
      if (validLegs.length === 0) return;
      orderLockRef.current = true;
      setBasketPending(true);
      let targetSender = "";
      try {
        const sender = await resolveSender(eth);
        targetSender = sender.toLowerCase();
        if (targetSender !== walletAddress.toLowerCase()) {
          // The sell amounts came from the balances of the previously shown account: refresh, don't sell
          const cid = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
          attachWalletRef.current(eth, sender, cid);
          throw new Error("Your wallet switched to another account. Balances were refreshed: check them and try again.");
        }
        const order = await prepareSell({ eth, sender, legs: validLegs, slippageBps: slippageRef.current, onStatus: updateBasketStatus });
        if (walletRef.current !== targetSender) return;
        setChainIdHex("0x2105");
        setReview({ order, label, legs: { sell: validLegs } });
      } catch (err: unknown) {
        if (!targetSender || walletRef.current === targetSender) {
          setBasketError(errMsg(err, "Could not prepare the sale"));
        }
      } finally {
        orderLockRef.current = false;
        updateBasketStatus("");
        setBasketPending(false);
      }
    },
    [nonUsComplianceAccepted, walletAddress, getEthProvider, resolveSender, updateBasketStatus]
  );

  // Re-quote the order under review (expired quote or user request)
  const refreshReview = useCallback(async (newSlippageBps?: number) => {
    if (!review || reviewBusyRef.current) return;
    reviewBusyRef.current = true;
    if (newSlippageBps) {
      slippageRef.current = newSlippageBps;
      setSlippageBps(newSlippageBps);
      try {
        localStorage.setItem("maxxagent_slippage_bps", String(newSlippageBps));
      } catch {}
    }
    const eth = getEthProvider();
    if (!eth) {
      reviewBusyRef.current = false;
      return;
    }
    const targetSender = review.order.sender.toLowerCase();
    setReviewBusy(true);
    setBasketError("");
    try {
      const { sender } = review.order;
      const order = review.legs.buy
        ? await prepareBuy({ eth, sender, legs: review.legs.buy, slippageBps: slippageRef.current, onStatus: updateBasketStatus })
        : await prepareSell({ eth, sender, legs: review.legs.sell || [], slippageBps: slippageRef.current, onStatus: updateBasketStatus });
      if (walletRef.current !== targetSender) return;
      setChainIdHex("0x2105");
      setReview((cur) => (cur ? { ...cur, order } : null));
    } catch (err: unknown) {
      if (walletRef.current !== targetSender) return;
      setReview(null);
      setBasketError(errMsg(err, "Could not refresh the quote"));
    } finally {
      reviewBusyRef.current = false;
      updateBasketStatus("");
      setReviewBusy(false);
    }
  }, [review, getEthProvider, updateBasketStatus]);

  // Step 2: the user confirmed the review; only now does the wallet open
  const confirmReview = useCallback(async () => {
    if (!review || orderLockRef.current || txPendingRef.current) return;
    if (Date.now() - review.order.preparedAt >= QUOTE_TTL_MS - 2000) {
      await refreshReview(); // refresh quotes with >= 2s margin before submitOrder's TTL guard
      return;
    }
    const eth = getEthProvider();
    if (!eth) return;
    orderLockRef.current = true;
    const { order, label } = review;
    const targetSender = order.sender.toLowerCase();
    const preTxUsdcBalance = label === "rebalance" && order.side === "sell" ? usdcBalanceRef.current : null;
    setReview(null);
    setBasketPending(true);
    try {
      const activeAccounts = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (activeAccounts?.[0] && activeAccounts[0].toLowerCase() !== targetSender) {
        const cid = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
        syncAutoWalletRef.current(eth, activeAccounts[0], cid);
        throw new Error("Your wallet switched to another account. Please review a fresh quote.");
      }
      const result = await submitOrder({
        eth,
        order,
        builderCode,
        onStatus: updateBasketStatus,
        walletHint: walletMetaRef.current,
      });
      if (walletRef.current === targetSender) recordResult(result, label, preTxUsdcBalance);
    } catch (err: unknown) {
      if (walletRef.current === targetSender) {
        setBasketError(
          errMsg(err, order.side === "buy" ? "Purchase cancelled or failed" : "Sale cancelled or failed")
        );
      }
    } finally {
      orderLockRef.current = false;
      updateBasketStatus("");
      setBasketPending(false);
    }
  }, [review, refreshReview, getEthProvider, builderCode, recordResult, updateBasketStatus]);

  // Hydrate the activity log from localStorage
  useEffect(() => {
    try {
      const savedLog = window.localStorage.getItem("maxxagent_activity_log");
      if (savedLog) {
        const parsed = JSON.parse(savedLog);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Drop the old seeded example entry and simulated sandbox hashes from earlier versions
          setActivityLog(
            parsed.filter(
              (e: OnchainActivityEntry) => e?.id !== "seed-1" && e?.network !== "Virtual $10k Sandbox"
            )
          );
        }
      }
    } catch {}
  }, []);

  // Fetch live B20 Tokenized Stocks + Chainlink Oracles + Live Aerodrome DEX Pools on Base Mainnet
  const walletRef = useRef("");
  walletRef.current = walletAddress.toLowerCase();
  const attachWalletRef = useRef<(eth: EthereumProvider, addr: string, chainHex: string) => void>(() => {});
  const stocksFetchCtrl = useRef<AbortController | null>(null);
  const stocksFetchSeq = useRef(0);
  const fetchLiveStocks = useCallback(async (walletToQuery?: string, silent = false) => {
    // Never let a silent 60s market poll abort an active non-silent wallet balance fetch
    if (silent && stocksFetchCtrl.current && !stocksFetchCtrl.current.signal.aborted) return;
    stocksFetchCtrl.current?.abort();
    const ctrl = new AbortController();
    stocksFetchCtrl.current = ctrl;
    const seq = ++stocksFetchSeq.current;
    if (!silent) setLoadingStocks(true);
    try {
      const q = walletToQuery ? `?wallet=${encodeURIComponent(walletToQuery)}` : "";
      const res = await fetch(`/api/stocks${q}`, { signal: ctrl.signal });
      const data = await res.json();
      if (seq !== stocksFetchSeq.current) return;
      if (walletToQuery && walletRef.current !== walletToQuery.toLowerCase()) return;
      if (data?.ok && Array.isArray(data.stocks)) {
        setStocks(data.stocks);
        setTotalTvlUsd(data.totalBaseStocksTvlUsd || 0);
        setTotalDexLiquidityUsd(data.totalBaseDexLiquidityUsd || 0);
        setTotalDexVolume24hUsd(data.totalBaseDexVolume24hUsd || 0);
        setFetchedAt(data.fetchedAt || new Date().toISOString());
        if (data.walletBalances) {
          setWalletBalances(data.walletBalances);
          if (walletToQuery) setBalancesFor(walletToQuery.toLowerCase());
        }
        if (walletToQuery) setBalancesError(data.walletError || (data.walletBalances ? "" : "Could not read your balances."));
        if (typeof data.walletUsdc === "number") setUsdcBalance(data.walletUsdc);
        if (typeof data.walletEth === "number") setEthBalance(data.walletEth);
        if (typeof data.ethUsd === "number") setEthUsd(data.ethUsd);
      } else if (walletToQuery) {
        setBalancesError(data?.error || "Could not read your balances.");
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      if (walletToQuery) setBalancesError("Could not reach the server. Check your connection.");
      console.error("Failed to fetch live tokenized stocks:", err);
    } finally {
      if (stocksFetchCtrl.current === ctrl) stocksFetchCtrl.current = null;
      if (!silent && seq === stocksFetchSeq.current) setLoadingStocks(false);
    }
  }, []);

  // Run AI Stock Agent (analysis only; execution always happens from the user's own wallet)
  // Only the newest run may set the report: an older one finishing later (e.g. the first-visit proposal) is ignored
  const agentRunId = useRef(0);
  const triggerStockAgent = useCallback(
    async (
      stocksData?: LiveTokenizedStock[],
      promptOverride?: string,
      options?: { followUp?: string; riskOverride?: "Conservative" | "Balanced" | "Aggressive" }
    ) => {
      const follow = options?.followUp?.trim();
      const baseHistory =
        mandateHistoryRef.current.length > 0
          ? mandateHistoryRef.current
          : [
              (agentReportPromptRef.current || userPrompt).trim() ||
                "AI and cloud compute leaders, prefer stocks trading below NAV",
            ];
      const nextSteps = follow
        ? capPromptSteps([...baseHistory, follow], 6)
        : [
            (promptOverride ?? userPrompt).trim() ||
              "AI and cloud compute leaders, prefer stocks trading below NAV",
          ];
      if (!follow) setFollowUpPrompt("");
      const runId = ++agentRunId.current;
      setRunningAgent(true);
      setAgentError("");
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stocks: stocksData || stocks,
            userPrompt: nextSteps[nextSteps.length - 1],
            promptSteps: nextSteps.length > 1 ? nextSteps : undefined,
            riskProfile: options?.riskOverride ?? riskProfile,
            capitalUsd,
            builderCode,
          }),
        });
        const data = await res.json();
        if (runId !== agentRunId.current) return;
        if (data?.ok && data.report) {
          setAgentReport(data.report);
          mandateHistoryRef.current = nextSteps;
          setMandateHistory(nextSteps);
          if (follow) setFollowUpPrompt("");
        } else {
          setAgentError(data?.error || "Could not run the stock agent right now. Please retry.");
        }
      } catch (err) {
        if (runId === agentRunId.current) {
          setAgentError(errMsg(err, "Could not run the stock agent right now. Please retry."));
        }
        console.error("Agent error:", err);
      } finally {
        if (runId === agentRunId.current) setRunningAgent(false);
      }
    },
    [stocks, userPrompt, riskProfile, capitalUsd, builderCode]
  );

  useEffect(() => {
    fetchLiveStocks().then(() => {});
  }, [fetchLiveStocks]);

  // Market tab open and visible: refresh prices quietly every 60 s (market data only, no wallet reads).
  // The server keeps the market for 15 s, so this adds almost no RPC load however many people watch.
  useEffect(() => {
    if (activeTab !== "terminal") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fetchLiveStocks(undefined, true);
    }, 60_000);
    return () => clearInterval(id);
  }, [activeTab, fetchLiveStocks]);

  useEffect(() => {
    if (balanceRefreshNonce > 0 && walletAddress) fetchLiveStocks(walletAddress);
  }, [balanceRefreshNonce, walletAddress, fetchLiveStocks]);

  useEffect(() => {
    if (!walletAddress || balancesFor !== walletAddress.toLowerCase()) return;
    let cancelled = false;
    const w = walletAddress.toLowerCase();
    const ctrl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      fetch(`/api/pnl?wallet=${w}${balanceRefreshNonce > 0 ? "&fresh=1" : ""}`, { signal: ctrl.signal })
        .then(async (r) => {
          const d = await r.json();
          if (cancelled) return;
          // 503/502 = server busy or transient RPC error: retry once instead of failing immediately.
          // loading = a long first scan is still running server-side: check back a few times.
          if ((r.status === 503 || r.status === 502) && attempt === 0) retry = setTimeout(() => load(1), r.status === 503 ? 5000 : 2500);
          else if (d?.loading && attempt < 4) retry = setTimeout(() => load(attempt + 1), 8000);
          else setPnl({ for: w, data: d?.ok ? d : null, error: d?.ok ? "" : d?.error || "P/L unavailable" });
        })
        .catch((err) => {
          if (cancelled || (err as { name?: string })?.name === "AbortError") return;
          // A first scan of a long history can hit the host's time limit; the work done so far is cached
          // server-side, so one more try usually completes
          if (attempt === 0) retry = setTimeout(() => load(1), 3000);
          else setPnl({ for: w, data: null, error: "P/L unavailable right now. Please refresh in a moment." });
        });
    load(0);
    return () => {
      cancelled = true;
      ctrl.abort();
      if (retry) clearTimeout(retry);
    };
  }, [walletAddress, balancesFor, balanceRefreshNonce]);

  // First visit: one proposal from URL ?prompt= (if provided) or the default request, started once.
  const autoRunStarted = useRef(false);
  useEffect(() => {
    if (autoRunStarted.current || stocks.length === 0 || agentReport || runningAgent) return;
    autoRunStarted.current = true;
    const urlPrompt = new URLSearchParams(window.location.search).get("prompt")?.trim().slice(0, 500);
    if (urlPrompt) setUserPrompt(urlPrompt);
    triggerStockAgent(stocks, urlPrompt || undefined);
  }, [stocks, agentReport, runningAgent, triggerStockAgent]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 2200);
    } catch {}
  };


  // Remember the wallet the user picked, so a page refresh reconnects silently (no popup)
  const WALLET_STORAGE_KEY = "maxxagent_wallet";
  type SavedWallet =
    | { kind: "injected"; rdns: string; name: string }
    | { kind: "browser"; name: string }
    | { kind: ExternalWalletKind };
  const saveWallet = (w: SavedWallet | null) => {
    try {
      if (w) localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(w));
      else localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {}
  };

  // Shared by manual connect and silent restore: show the account, read balances, listen for changes
  const attachWallet = (eth: EthereumProvider, account: string, chainId: unknown) => {
    const normalized = normalizeChainHex(chainId);
    const prevAccount = walletRef.current;
    walletRef.current = account.toLowerCase();
    if (prevAccount && prevAccount !== account.toLowerCase()) {
      stocksFetchCtrl.current?.abort();
      stocksFetchSeq.current++;
      setWalletBalances({});
      setBalancesFor("");
      setBalancesError("");
      setUsdcBalance(null);
      setEthBalance(null);
      setRebalanceUsdcBaseline(null);
      setPnl({ for: "", error: "", data: null });
    }
    setWalletAddress(account);
    setChainIdHex(normalized);
    fetchLiveStocks(account);
    // Some extensions report "0x1" for the first ~200ms after reload while waking up; re-read quietly once
    if (attachTimerRef.current) clearTimeout(attachTimerRef.current);
    if (normalized !== "0x2105") {
      attachTimerRef.current = setTimeout(() => {
        if (providerRef.current !== eth) return;
        eth
          .request({ method: "eth_chainId" })
          .then((c) => {
            if (providerRef.current !== eth) return;
            const nextChain = normalizeChainHex(c);
            if (nextChain) setChainIdHex(nextChain);
          })
          .catch(() => {});
      }, 500);
    }
    // One set of listeners at a time: reconnecting must not stack duplicates
    detachListenersRef.current?.();
    const onAccounts = (...args: unknown[]) => {
      const next = (args[0] as string[] | undefined)?.[0] || "";
      walletRef.current = next.toLowerCase();
      stocksFetchCtrl.current?.abort();
      stocksFetchSeq.current++;
      setLoadingStocks(false);
      setWalletAddress(next);
      setWalletBalances({});
      setBalancesFor("");
      setBalancesError("");
      setUsdcBalance(null);
      setEthBalance(null);
      setReview(null);
      setBasketError("");
      setBasketResult(null);
      setRebalanceUsdcBaseline(null);
      setPnl({ for: "", error: "", data: null });
      if (next) fetchLiveStocks(next);
      else {
        setChainIdHex("");
        setConnectedWalletName("");
        walletMetaRef.current = undefined;
        if (!inMiniAppRef.current) {
          detachListenersRef.current?.();
          detachListenersRef.current = null;
          providerRef.current = null;
          // Clear WalletConnect/Coinbase SDK handles when the wallet closes the session remotely (`session_delete`)
          void disconnectExternalWallets();
        }
        saveWallet(null); // disconnected from inside the wallet: don't auto-reconnect
      }
    };
    const onChain = (...args: unknown[]) => {
      const hex = normalizeChainHex(args[0]);
      if (hex) setChainIdHex(hex);
    };
    const onDisconnect = () => {
      if (!walletRef.current) return;
      if (walletMetaRef.current?.external === "walletconnect") {
        onAccounts([]);
        return;
      }
      void eth
        .request({ method: "eth_accounts" })
        .then((a) => {
          if (!Array.isArray(a) || !a[0]) onAccounts([]);
        })
        .catch(() => onAccounts([]));
    };
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    eth.on?.("disconnect", onDisconnect);
    detachListenersRef.current = () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
      eth.removeListener?.("disconnect", onDisconnect);
    };
  };
  attachWalletRef.current = attachWallet;
  syncAutoWalletRef.current = (eth: EthereumProvider, sender: string, chainId?: unknown) => {
    providerRef.current = eth;
    if (!walletMetaRef.current) {
      if (inMiniAppRef.current) {
        walletMetaRef.current = { name: "Mini app wallet" };
        setConnectedWalletName("Mini app wallet");
      } else {
        const eipMatch = walletProviders.find((p) => p.provider === eth);
        if (eipMatch) {
          walletMetaRef.current = { name: eipMatch.info.name, rdns: eipMatch.info.rdns };
          setConnectedWalletName(eipMatch.info.name);
          saveWallet({ kind: "injected", rdns: eipMatch.info.rdns, name: eipMatch.info.name });
        } else {
          const name = detectInjectedName(eth);
          walletMetaRef.current = { name, external: "browser" };
          setConnectedWalletName(name);
          saveWallet({ kind: "browser", name });
        }
      }
    }
    attachWallet(eth, sender, chainId);
  };

  const disconnectWallet = async () => {
    setAccountMenuOpen(false);
    walletRef.current = "";
    if (attachTimerRef.current) {
      clearTimeout(attachTimerRef.current);
      attachTimerRef.current = null;
    }
    stocksFetchCtrl.current?.abort();
    stocksFetchSeq.current++;
    setLoadingStocks(false);
    detachListenersRef.current?.();
    detachListenersRef.current = null;
    try {
      localStorage.removeItem("maxxagent_wallet");
    } catch {}
    await disconnectExternalWallets();
    if (!inMiniAppRef.current) providerRef.current = null; // in a mini app the host wallet stays the provider
    walletMetaRef.current = undefined;
    setWalletAddress("");
    setWalletBalances({});
    setBalancesFor("");
    setBalancesError("");
    setUsdcBalance(null);
    setEthBalance(null);
    setChainIdHex("");
    setReview(null);
    setBasketError("");
    setBasketResult(null);
    setRebalanceUsdcBaseline(null);
    setPnl({ for: "", error: "", data: null });
    setConnectedWalletName("");
  };

  // Connect EVM Wallet & switch to Base Mainnet (8453)
  const connectWallet = async (picked?: Eip6963ProviderDetail, external?: ExternalWalletKind) => {
    if (connectingWalletRef.current) return;
    connectingWalletRef.current = true;
    setConnectingWallet(true);
    setTxError("");
    setShowWalletMenu(false);
    try {
      let candidateEth: EthereumProvider | null = picked?.provider ?? null;
      let candidateName = picked?.info.name ?? "";
      let candidateMeta: WalletHint | undefined = picked
        ? { name: picked.info.name, rdns: picked.info.rdns }
        : undefined;
      if (external) {
        // Coinbase Smart Wallet (passkey popup) or WalletConnect (QR / mobile deep link)
        try {
          candidateEth = (await connectExternalWallet(external)) as EthereumProvider;
          candidateName = external === "coinbase" ? "Coinbase Smart Wallet" : "WalletConnect";
          candidateMeta = { name: candidateName, external };
        } catch (err: unknown) {
          const msg = errMsg(err, "");
          setTxError(
            /request reset|reject|closed|cancel|dibatalkan|ditolak|batal/i.test(msg)
              ? "Wallet connection cancelled."
              : "Could not connect the wallet. Please try again."
          );
          return;
        }
      }
      const eth = candidateEth ?? getEthProvider();
      if (!eth) {
        setTxError(
          "No wallet found in this browser. Choose Coinbase Smart Wallet or WalletConnect from the Connect menu."
        );
        return;
      }
      if (!candidateMeta) {
        if (inMiniAppRef.current) {
          candidateMeta = { name: "Mini app wallet" };
        } else {
          candidateName = candidateName || detectInjectedName(eth);
          candidateMeta = { name: candidateName, external: "browser" };
        }
      }
      try {
        const accounts = (await eth.request({
          method: "eth_requestAccounts",
        })) as string[];
        let chainId = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
        if (accounts && accounts[0]) {
          providerRef.current = eth;
          walletMetaRef.current = candidateMeta;
          if (candidateName) setConnectedWalletName(candidateName);
          if (chainId && chainId !== "0x2105") {
            try {
              chainId = await switchOrAddBaseChain(eth);
            } catch {
              // Keep connected even if user postpones switching until trade time
            }
          }
          attachWallet(eth, accounts[0], chainId);
          if (external) saveWallet({ kind: external });
          else if (picked) saveWallet({ kind: "injected", rdns: picked.info.rdns, name: picked.info.name });
          else if (!inMiniAppRef.current) saveWallet({ kind: "browser", name: candidateName || detectInjectedName(eth) });
        }
      } catch (err: unknown) {
        const msg = errMsg(err, "Wallet connection rejected");
        setTxError(
          /request reset|reject|closed|cancel|dibatalkan|ditolak|batal/i.test(msg)
            ? "Wallet connection cancelled."
            : msg
        );
      }
    } finally {
      connectingWalletRef.current = false;
      setConnectingWallet(false);
    }
  };

  // Opened as a mini app (Farcaster / Base App): use the host's wallet, already authorised by the user there
  const restoreTried = useRef(false);
  const [inMiniApp, setInMiniApp] = useState(false);
  const [miniAppChecked, setMiniAppChecked] = useState(false);

  // Detect mini app host first so saved browser/external sessions never race or overwrite it;
  // also restore browser/external sessions independently of asynchronous EIP-6963 announcements.
  useEffect(() => {
    if (termsAccepted !== true) return;
    let cancelled = false;
    let browserRetryTimer: number | undefined;
    const finish = async (eth: EthereumProvider, name: string, meta: WalletHint) => {
      const accounts = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (cancelled || inMiniAppRef.current || walletRef.current || connectingWalletRef.current || !accounts?.[0]) return;
      const chainId = (await eth.request({ method: "eth_chainId" }).catch(() => "")) as string;
      if (cancelled || inMiniAppRef.current || walletRef.current || connectingWalletRef.current) return;
      providerRef.current = eth;
      walletMetaRef.current = meta;
      setConnectedWalletName(name);
      attachWalletRef.current(eth, accounts[0], chainId);
    };
    (async () => {
      const found = await detectMiniApp();
      if (cancelled) return;
      setMiniAppChecked(true);
      if (found) {
        inMiniAppRef.current = true;
        restoreTried.current = true; // the host wallet replaces any saved browser wallet
        const eth = found.provider as EthereumProvider;
        providerRef.current = eth;
        walletMetaRef.current = { name: "Mini app wallet" };
        setInMiniApp(true);
        setConnectedWalletName("Mini app wallet");
        try {
          const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
          const chainId = (await eth.request({ method: "eth_chainId" }).catch(() => "")) as string;
          if (!cancelled && accounts?.[0]) attachWalletRef.current(eth, accounts[0], chainId);
        } catch {
          // The user can still connect from the Connect button (it uses the host wallet)
        }
        return;
      }
      if (restoreTried.current || walletRef.current || connectingWalletRef.current) return;
      let saved: SavedWallet | null = null;
      try {
        saved = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY) || "null");
      } catch {}
      if (!saved) {
        restoreTried.current = true;
        return;
      }
      if (saved.kind === "injected") return; // handled by the EIP-6963 effect below
      if (saved.kind === "browser") {
        const savedName = (saved as { name?: string }).name || "";
        const tryBrowser = (): boolean => {
          if (connectingWalletRef.current || walletRef.current) return true;
          const eth = getInjectedFallback();
          if (!eth) return false;
          restoreTried.current = true;
          const resolvedName = savedName && savedName !== "Browser wallet" ? savedName : detectInjectedName(eth);
          void finish(eth, resolvedName, { name: resolvedName, external: "browser" });
          return true;
        };
        if (tryBrowser()) return;
        // Mobile WebViews may finish injecting window.ethereum / window.binancew3w slightly after hydration
        browserRetryTimer = window.setTimeout(() => {
          if (cancelled || restoreTried.current || connectingWalletRef.current) return;
          restoreTried.current = true;
          tryBrowser();
        }, 450);
        return;
      }
      const kind = saved.kind;
      const externalName = kind === "coinbase" ? "Coinbase Smart Wallet" : "WalletConnect";
      const extEth = await restoreExternalWallet(kind);
      if (cancelled || connectingWalletRef.current) return;
      restoreTried.current = true;
      if (extEth) await finish(extEth as EthereumProvider, externalName, { name: externalName, external: kind });
    })();
    return () => {
      cancelled = true;
      if (browserRetryTimer !== undefined) window.clearTimeout(browserRetryTimer);
    };
  }, [termsAccepted]);

  // Silent reconnect for EIP-6963 extensions once they announce themselves (after mini app detection completes).
  useEffect(() => {
    if (
      termsAccepted !== true ||
      !miniAppChecked ||
      inMiniAppRef.current ||
      restoreTried.current ||
      walletAddress ||
      connectingWalletRef.current
    )
      return;
    let saved: SavedWallet | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY) || "null");
    } catch {}
    if (!saved || saved.kind !== "injected") return;
    const match = walletProviders.find((p) => p.info.rdns === (saved as { rdns: string }).rdns);
    if (!match) return;
    let cancelled = false;
    const eth = match.provider as EthereumProvider;
    (async () => {
      const accounts = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (cancelled || inMiniAppRef.current || walletRef.current || connectingWalletRef.current) return;
      restoreTried.current = true;
      if (!accounts?.[0]) return;
      const chainId = (await eth.request({ method: "eth_chainId" }).catch(() => "")) as string;
      if (cancelled || inMiniAppRef.current || walletRef.current || connectingWalletRef.current) return;
      providerRef.current = eth;
      walletMetaRef.current = { name: match.info.name, rdns: match.info.rdns };
      setConnectedWalletName(match.info.name);
      attachWalletRef.current(eth, accounts[0], chainId);
    })();
    return () => {
      cancelled = true;
    };
  }, [walletProviders, walletAddress, termsAccepted, miniAppChecked]);

  const switchToBaseMainnet = async () => {
    const eth = getEthProvider();
    if (!eth) return;
    try {
      const switchedHex = await switchOrAddBaseChain(eth);
      setChainIdHex(switchedHex);
    } catch (err: unknown) {
      setTxError(errMsg(err, "Failed to switch to Base network"));
      throw err;
    }
  };

  // Publish an index to StockMaxxIndexRegistry (non-custodial: stores names & weights only)
  const publishIndexOnchain = async (
    name: string,
    ticker: string,
    entries: { b20Address: string; weightBps: number }[]
  ) => {
    if (txPendingRef.current || orderLockRef.current) return;
    setTxError("");
    setTxHash("");
    if (!nonUsComplianceAccepted) {
      setTxError("Please accept the terms first (reload the page to see them).");
      return;
    }
    if (!hasRegistry) {
      setTxError("The index registry is not deployed yet (NEXT_PUBLIC_INDEX_REGISTRY_ADDRESS is empty).");
      return;
    }
    const active = entries.filter((e) => e.weightBps > 0);
    const total = active.reduce((a, e) => a + e.weightBps, 0);
    if (active.length === 0 || active.length > 10 || total !== 10000) {
      setTxError("An index needs 1–10 stocks with weights summing to exactly 100% (10,000 bps).");
      return;
    }
    // The registry limits bytes, not characters (emoji / non-latin names take several bytes each)
    const clampBytes = (v: string, max: number) => {
      const enc = new TextEncoder();
      let out = "";
      for (const ch of v.trim()) {
        if (enc.encode(out + ch).length > max) break;
        out += ch;
      }
      return out;
    };
    const cleanName = clampBytes(name, 64);
    const cleanTicker = clampBytes(ticker, 16);
    if (!cleanName || !cleanTicker) {
      setTxError("Please enter an index name and ticker.");
      return;
    }
    if (!walletAddress && !inMiniAppRef.current) {
      setShowWalletMenu(true);
      setTxError("Connect your wallet first to publish an index on Base.");
      return;
    }
    const eth = getEthProvider();
    if (!eth) {
      setShowWalletMenu(true);
      setTxError("No wallet detected. Install Coinbase Wallet or MetaMask to publish on Base.");
      return;
    }
    txPendingRef.current = true;
    setTxPending(true);
    setPublishStatus("Checking…");
    try {
      // The account that will actually sign (never a stale one from before an account switch)
      const sender = walletAddress ? await resolveSender(eth) : ((await eth.request({ method: "eth_requestAccounts" })) as string[])?.[0];
      if (!sender) throw new Error("No wallet account connected.");
      if (!walletAddress || sender.toLowerCase() !== walletAddress.toLowerCase()) {
        const cid = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
        syncAutoWalletRef.current(eth, sender, cid);
      }
      // The dry run must hit Base (on another chain the registry address has no code and would "pass")
      const currentChain = normalizeChainHex(await eth.request({ method: "eth_chainId" }).catch(() => ""));
      if (!currentChain) {
        throw new Error("Could not verify your wallet network. Make sure your wallet is on Base Mainnet (8453) and try again.");
      }
      if (currentChain !== "0x2105") await switchToBaseMainnet();
      const calldata = encodeFunctionData({
        abi: INDEX_REGISTRY_ABI,
        functionName: "createIndex",
        args: [
          cleanName,
          cleanTicker,
          active.map((e) => e.b20Address as `0x${string}`),
          active.map((e) => e.weightBps),
        ],
      });
      // Dry run first: a rejected index fails here with a clear reason instead of costing gas
      try {
        await withRpcTimeout(
          eth.request({ method: "eth_call", params: [{ from: sender, to: registryAddress, data: calldata }, "latest"] }),
          10_000,
          "Preflight simulation timed out"
        );
      } catch (simErr) {
        const raw = extractRevertData(simErr);
        let reason = "";
        try {
          if (raw) reason = decodeErrorResult({ abi: INDEX_REGISTRY_ABI, data: raw as `0x${string}` }).errorName;
        } catch {}
        const nice: Record<string, string> = {
          InvalidName: "the name must be 1–64 bytes",
          InvalidTicker: "the ticker must be 1–16 bytes",
          TokenNotAllowed: "a stock is not on the registry allowlist",
          DuplicateToken: "a stock is listed twice",
          WeightsMustSumTo10000: "weights must sum to exactly 100%",
          ZeroWeight: "every stock needs a weight above 0",
          InvalidConstituentCount: "an index needs 1–10 stocks",
        };
        const simMsg = errMsg(simErr, "");
        if (reason || raw || /revert|execution/i.test(simMsg)) {
          throw new Error(`The registry would reject this index${reason ? `: ${nice[reason] || reason}` : ""}. Nothing was sent.`);
        }
        throw new Error(simMsg ? `Could not check the index against Base RPC (${simMsg}). Please retry.` : "Could not check the index against Base RPC. Please retry.");
      }
      const hash = await sendContractCall({
        eth,
        sender,
        to: registryAddress,
        data: calldata,
        builderCode,
        onStatus: setPublishStatus,
        walletHint: walletMetaRef.current,
      });
      setTxHash(hash);
      recordOnchainActivity(`PUBLISH_INDEX ${cleanTicker}`, hash, "Base Mainnet (8453)");
      loadPublishedIndexes();
    } catch (err: unknown) {
      setTxError(errMsg(err, "Transaction cancelled or failed"));
    } finally {
      txPendingRef.current = false;
      setPublishStatus("");
      setTxPending(false);
    }
  };

  // Published indexes from the registry
  const [publishedIndexes, setPublishedIndexes] = useState<
    {
      id: number;
      name: string;
      ticker: string;
      creator: string;
      version: number;
      constituents: { symbol: string; b20Address: string; weightBps: number }[];
    }[]
  >([]);
  const [indexesStatus, setIndexesStatus] = useState<string>("");
  const loadPublishedIndexes = useCallback(async () => {
    setIndexesStatus("Loading…");
    try {
      const res = await fetch("/api/indexes", { cache: "no-store" });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Failed to load");
      setPublishedIndexes(data.indexes || []);
      setIndexesStatus(
        data.deployed
          ? `${(data.indexes || []).length} index${(data.indexes || []).length === 1 ? "" : "es"} published`
          : "Registry not deployed yet"
      );
    } catch (e) {
      setIndexesStatus(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);
  useEffect(() => {
    if (activeTab === "indexes") loadPublishedIndexes();
  }, [activeTab, loadPublishedIndexes]);

  // How often each published index was bought (from onchain swaps; null until the stats answer)
  const [indexBuys, setIndexBuys] = useState<Record<number, { buys: number; volumeUsd: number; wallets: number }> | null>(null);
  useEffect(() => {
    if (activeTab !== "indexes" || indexBuys) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      fetch("/api/stats")
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          if (d?.loading && attempt < 3) {
            timer = setTimeout(() => load(attempt + 1), 10_000);
            return;
          }
          if (!d?.ok || !Array.isArray(d.indexBuys)) return;
          setIndexBuys(Object.fromEntries((d.indexBuys as { id: number; buys: number; volumeUsd: number; wallets: number }[]).map((x) => [x.id, x])));
        })
        .catch(() => {});
    };
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeTab, indexBuys]);
  const [indexSort, setIndexSort] = useState<"volume" | "buys" | "newest">("volume");

  const applyCustomWeights = useCallback((next: Record<string, number>) => {
    setCustomWeights(next);
    const active = Object.entries(next)
      .filter(([, w]) => w > 0)
      .map(([s]) => s);
    setBuilderPinned(active);
    if (active.length === 0) setBuilderView((v) => (v === "selected-only" ? "selected-first" : v));
  }, []);

  const normalizeCustomWeights = () => {
    const entries = Object.entries(customWeights).filter(([, w]) => w > 0);
    if (entries.length === 0) return;
    const rounded = roundWeightsBps(entries.map(([, w]) => w));
    if (!rounded) return;
    const next: Record<string, number> = {};
    entries.forEach(([sym], idx) => {
      next[sym] = rounded[idx];
    });
    applyCustomWeights(next);
  };

  const equalizeCustomWeights = () => {
    const activeSymbols = Object.entries(customWeights)
      .filter(([, w]) => w > 0)
      .map(([sym]) => sym);
    const targets = activeSymbols.length > 0 ? activeSymbols : BASE_TOKENIZED_STOCKS.map((s) => s.symbol);
    const rounded = roundWeightsBps(targets.map(() => 1));
    if (!rounded) return;
    const next: Record<string, number> = {};
    targets.forEach((sym, idx) => {
      next[sym] = rounded[idx];
    });
    applyCustomWeights(next);
  };

  const clearCustomWeights = () => applyCustomWeights({});

  const totalCustomWeightBps = Object.values(customWeights).reduce((a, b) => a + b, 0);

  // Opened from a shared link: load the basket into the index builder (the user still reviews and confirms)
  const [sharedBasketLoaded, setSharedBasketLoaded] = useState<boolean>(false);
  useEffect(() => {
    // /?stock=NVDAc (from a stock detail page): select it and jump to the Swap panel
    // /?tab=portfolio (drift alert notifications): open the portfolio, where the saved target and its plan are
    const fromUrl = TAB_BY_SLUG[new URLSearchParams(window.location.search).get("tab") || ""];
    if (fromUrl) setActiveTab(fromUrl);
    const q = new URLSearchParams(window.location.search);
    const urlPrompt = q.get("prompt")?.trim().slice(0, 500);
    if (urlPrompt) {
      setUserPrompt(urlPrompt);
      setActiveTab("agent");
    }
    const wanted = q.get("stock");
    const match = BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === (wanted || "").toLowerCase());
    if (match) {
      setChartSelectedSymbol(match.symbol);
      setActiveTab("terminal");
      scrollWhenReady("#swap-panel", "center");
    }
    const shared = parseSharedBasket(window.location.search);
    if (!shared) return;
    applyCustomWeights(shared.weightsBps);
    const pay = q.get("pay");
    if (pay === "eth" || pay === "usdc") setBasketPayWith(pay);
    const sharedName = cleanIndexName(q.get("name"));
    setCustomIndexName(sharedName || "Shared basket");
    if (shared.amountUsd) setBasketUsd(shared.amountUsd);
    setActiveTab("indexes");
    setSharedBasketLoaded(true);
    scrollWhenReady("#index-builder", "start");
    // Mark URL ready on the next animation frame (after React commits activeTab = "indexes") so initial load doesn't push duplicate history
    requestAnimationFrame(() => {
      tabUrlReady.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!tabUrlReady.current) {
      requestAnimationFrame(() => {
        tabUrlReady.current = true;
      });
    }
  }, []);
  const shareLinkFor = (weightsBps: Record<string, number>, amountUsd?: number) =>
    `${typeof window !== "undefined" ? window.location.origin : PUBLIC_SITE_URL}/?${basketToQuery(weightsBps, amountUsd ?? basketUsd)}`;

  // Filter, Search & Sort B20 Equities for Tab 1 Table
  const filteredStocks = stocks
    .filter((st) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        st.symbol.toLowerCase().includes(q) ||
        st.companyName.toLowerCase().includes(q) ||
        st.isin.toLowerCase().includes(q) ||
        st.sector.toLowerCase().includes(q);
      const matchesSector =
        selectedSectorFilter === "ALL" || st.sector === selectedSectorFilter;
      const matchesSignal =
        selectedSignalFilter === "ALL" ||
        (selectedSignalFilter === "DIVIDEND" && st.uiMultiplier > 1.00001) ||
        (selectedSignalFilter === "DISCOUNT" && st.weekendSignal === "BUY_DEX_DISCOUNT");
      return matchesSearch && matchesSector && matchesSignal;
    })
    .sort((a, b) => {
      if (tableSort.col === "default") return 0;
      const metric = (s: LiveTokenizedStock) =>
        tableSort.col === "nav"
          ? s.navPrice
          : tableSort.col === "change"
          ? s.change24hPct
          : tableSort.col === "gap"
          ? s.weekendGapPct ?? 0
          : tableSort.col === "mult"
          ? s.uiMultiplier
          : tableSort.col === "vol"
          ? s.dexVolume24hUsd ?? s.dexLiquidityUsd ?? 0
          : s.onchainMarketCapUsd;
      const diff = metric(a) - metric(b);
      return tableSort.dir === "asc" ? diff : -diff;
    });

  const toggleSort = (col: "nav" | "change" | "gap" | "mult" | "vol" | "mcap") =>
    setTableSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: col === "gap" ? "asc" : "desc" }
    );

  return (
    <div className="min-h-screen flex flex-col bg-[#03060e] text-slate-100 relative overflow-x-clip bg-cyber-grid xl:pl-60">
      {/* Ambient Base Blue & Cyan Aurora Lighting */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-44 left-1/4 h-[460px] w-[680px] rounded-full bg-[#4C6FFF]/15 blur-[140px]" />
        <div className="absolute top-64 right-1/6 h-[380px] w-[520px] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute bottom-0 left-1/3 h-[340px] w-[580px] rounded-full bg-emerald-500/8 blur-[140px]" />
      </div>

      {/* Wide screens: the sections and resources live in a fixed sidebar (the tab bar under the header hides) */}
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-slate-800/80 bg-[#040814]/95 backdrop-blur-xl xl:flex"
        aria-label="Sidebar"
      >
        <button
          type="button"
          onClick={() => {
            setActiveTab("terminal");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="px-4 pt-4 pb-3 text-left cursor-pointer"
          aria-label="MAXXAGENT home"
        >
          <MaxxAgentLogo size={34} tagline="Stock indexes on Base" />
        </button>
        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Sidebar sections">
          <p className="px-2 pb-1.5 pt-2 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">App</p>
          <div className="space-y-1">
            {SECTION_TABS.filter((tab) => tab.id !== "public" || studioMode).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "bg-gradient-to-r from-[#4C6FFF] to-[#1d4ed8] text-white shadow-lg shadow-[#4C6FFF]/25 border border-blue-400/30"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{tab.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-bold ${isActive ? "bg-white/20 text-white" : "bg-slate-800/90 text-slate-500"}`}>
                    {tab.badge}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="px-2 pb-1.5 pt-5 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-500">Resources</p>
          <div className="space-y-1">
            {RESOURCE_LINKS.map((l) => {
              const Icon = l.icon;
              return (
                <a
                  key={l.href}
                  href={l.href}
                  className="flex items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 text-[13px] font-semibold text-slate-400 transition hover:bg-slate-800/60 hover:text-slate-200"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{l.label}</span>
                  {l.isNew && <span className="rounded-full bg-cyan-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-300">New</span>}
                </a>
              );
            })}
          </div>
        </nav>
        <div className="space-y-2 border-t border-slate-800/80 px-4 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            LIVE · BASE MAINNET
          </span>
          <a
            href="https://github.com/0xAxelowETH/maxxagent"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-300"
          >
            <Code2 className="h-3.5 w-3.5" /> Open source (MIT)
          </a>
        </div>
      </aside>

      {/* Compact context bar */}
      <div className="relative z-30 border-b border-slate-800/80 bg-[#040814]/95 px-3 sm:px-4 py-1 text-[10px] sm:text-[11px] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-slate-400">
          <span className="inline-flex items-center gap-1.5 truncate">
            Built for Base Stocks Maxxing Season · independent project
          </span>
          <MarketStatus />
          <span className="hidden sm:inline">Not financial advice · eligible non-US persons only</span>
        </div>
      </div>

      {/* Live Infinite Wall Street x Base B20 Stock Ticker Tape */}
      <div className="relative z-30 border-b border-slate-800/80 bg-[#050a18]/90 py-1.5 sm:py-2 overflow-hidden">
        <div className="animate-ticker flex items-center gap-6 px-4">
          {[...(stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS), ...(stocks.length > 0 ? stocks : BASE_TOKENIZED_STOCKS)].map(
            (item, idx) => {
              const live = "navPrice" in item ? (item as LiveTokenizedStock) : null;
              // No placeholder numbers: show "…" until live data has loaded
              const price = live ? live.navPrice : null;
              const chg = live ? live.change24hPct : null;
              const mult = live ? live.uiMultiplier : item.defaultMultiplier;
              const gap = live ? live.weekendGapPct : 0;
              return (
                <div
                  key={`${item.symbol}-${idx}`}
                  onClick={() => setActiveTab("terminal")}
                  className="inline-flex items-center gap-2.5 rounded-xl border border-slate-800/90 bg-[#0a1226]/90 px-3 py-1.5 text-xs hover:border-[#4C6FFF]/60 transition cursor-pointer shrink-0"
                >
                  <img
                    src={item.logoUrl}
                    alt={item.symbol}
                    className="h-5 w-5 rounded-full object-cover border border-slate-700"
                  />
                  <span className="font-mono font-bold text-white">{item.symbol}</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {price === null ? "…" : `$${price.toFixed(2)}`}
                  </span>
                  {chg !== null && (
                    <span
                      className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        chg >= 0
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {chg >= 0 ? "+" : ""}
                      {chg.toFixed(2)}%
                    </span>
                  )}
                  {mult > 1.00001 && (
                    <span className="font-mono text-[10px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-1.5 py-0.5 rounded">
                      {mult.toFixed(4)}x UI
                    </span>
                  )}
                  {live && (
                    <span className="font-mono text-[10px] text-slate-400">
                      DEX {gap >= 0 ? "+" : ""}
                      {gap.toFixed(2)}%
                    </span>
                  )}
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* Main Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#040814]/90 backdrop-blur-xl shadow-2xl shadow-black/50">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3.5">
            {/* On wide screens the logo is in the sidebar */}
            <span className="xl:hidden">
              <MaxxAgentLogo size={40} tagline="Tokenized stock indexes on Base" />
            </span>
            <span className="hidden 2xl:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE · BASE MAINNET
            </span>
          </div>

          {/* Global KPIs, Theme Switcher & Wallet Connect */}
          <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-3">
            <div className="hidden xl:flex items-center gap-5 rounded-2xl border border-slate-800/90 bg-[#091022]/90 px-4 py-2 shadow-inner">
              <div className="flex items-center gap-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Base B20 Stock TVL
                  </div>
                  <div className="font-mono text-sm font-bold text-white">
                    {stocks.length > 0 ? `$${(totalTvlUsd / 1e6).toFixed(2)}M` : "…"}{" "}
                    {stocks.length > 0 && <span className="text-[10px] font-semibold text-emerald-400">Live</span>}
                  </div>
                </div>
              </div>
              <div className="h-7 w-px bg-slate-800" />
              <div className="flex items-center gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    24h Base DEX Vol
                  </div>
                  <div className="font-mono text-sm font-bold text-cyan-400">
                    {stocks.length > 0 ? `$${(totalDexVolume24hUsd / 1e6).toFixed(2)}M` : "…"}{" "}
                    {stocks.length > 0 && (
                      <span className="text-[10px] font-normal text-slate-400">(${(totalDexLiquidityUsd / 1e6).toFixed(2)}M Liq)</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <ThemeToggle />

            {walletAddress ? (
              <div className="flex items-center gap-1.5 sm:gap-2">
                {chainIdHex && normalizeChainHex(chainIdHex) !== "0x2105" && (
                  <button
                    onClick={() => switchToBaseMainnet()}
                    className="rounded-xl bg-amber-500/20 border border-amber-500/40 px-2 sm:px-3 py-2 text-[11px] sm:text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition cursor-pointer whitespace-nowrap"
                    title="Tokenized stocks are on Base Mainnet"
                  >
                    <span className="hidden sm:inline">Wrong network — switch to Base</span>
                    <span className="sm:hidden">Switch Base</span>
                  </button>
                )}
                <div className="relative" ref={accountMenuRef}>
                  <button
                    onClick={() => setAccountMenuOpen((v) => !v)}
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    aria-label="Wallet menu"
                    className="flex items-center gap-2 rounded-xl border border-[#4C6FFF]/60 bg-gradient-to-r from-[#4C6FFF]/25 to-cyan-500/15 px-2.5 sm:px-3.5 py-2 font-mono text-xs font-bold text-blue-100 shadow-md shadow-[#4C6FFF]/20 hover:brightness-110 cursor-pointer whitespace-nowrap"
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                    <span title={connectedWalletName || "Wallet"}>
                      {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                    </span>
                    <span className="hidden sm:inline text-slate-500">|</span>
                    <span className={`hidden sm:inline ${usdcBalance !== null && usdcBalance < basketUsd ? "text-amber-300" : "text-emerald-300"}`}>
                      {usdcBalance === null ? "… USDC" : `${usdcBalance.toFixed(2)} USDC`}
                    </span>
                    <ChevronDown className={`h-3 w-3 text-slate-400 transition ${accountMenuOpen ? "rotate-180" : ""}`} />
                  </button>
                  {accountMenuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-700 bg-[#0b1120] p-2 text-xs shadow-2xl"
                    >
                      <div className="px-2.5 py-2 border-b border-slate-800 mb-1">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500">{connectedWalletName || "Wallet"}</div>
                        <div className="font-mono text-[11px] text-slate-200 break-all">{walletAddress}</div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          {usdcBalance === null ? "…" : `${usdcBalance.toFixed(2)} USDC`}
                          {ethBalance !== null ? ` · ${ethBalance.toFixed(5)} ETH` : ""}
                        </div>
                      </div>
                      <button
                        role="menuitem"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(walletAddress);
                            setAddressCopied(true);
                            setTimeout(() => setAddressCopied(false), 1500);
                          } catch {}
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-200 hover:bg-slate-800 cursor-pointer"
                      >
                        {addressCopied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
                        {addressCopied ? "Copied" : "Copy address"}
                      </button>
                      <a
                        role="menuitem"
                        href={`https://basescan.org/address/${walletAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-slate-200 hover:bg-slate-800"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-slate-400" /> View on BaseScan
                      </a>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          setActiveTab("traction");
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-200 hover:bg-slate-800 cursor-pointer"
                      >
                        <Wallet className="h-3.5 w-3.5 text-slate-400" /> My portfolio
                      </button>
                      {!inMiniApp && (
                      <button
                        role="menuitem"
                        onClick={async () => {
                          await disconnectWallet();
                          setShowWalletMenu(true);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-slate-200 hover:bg-slate-800 cursor-pointer"
                      >
                        <RefreshCw className="h-3.5 w-3.5 text-slate-400" /> Switch wallet
                      </button>
                      )}
                      <button
                        role="menuitem"
                        onClick={disconnectWallet}
                        title="Disconnect"
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-rose-300 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" /> Disconnect
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="relative" ref={walletMenuRef}>
                <button
                  // Inside a mini app the host wallet is the only option: connect to it directly
                  onClick={() => (inMiniApp ? connectWallet() : setShowWalletMenu((v) => !v))}
                  disabled={connectingWallet}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-[#2563eb] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/35 hover:brightness-110 disabled:opacity-60 transition cursor-pointer border border-blue-400/30"
                >
                  <Wallet className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{connectingWallet ? "Connecting…" : "Connect wallet"}</span>
                  <span className="sm:hidden">{connectingWallet ? "…" : "Connect"}</span>
                </button>
                {showWalletMenu && (
                  <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-700 bg-[#0b1120] p-2 shadow-2xl z-50">
                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      {walletProviders.length > 0 ? "Wallets in this browser" : "Choose a wallet"}
                    </div>
                    {walletProviders.map((p) => (
                      <button
                        key={p.info.uuid}
                        onClick={() => connectWallet(p)}
                        disabled={connectingWallet}
                        className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                      >
                        {/^https:\/\//i.test(p.info.icon || "") || /^data:image\/(png|jpeg|webp|gif|svg\+xml)[,;]/i.test(p.info.icon || "") ? (
                          <img src={p.info.icon} alt="" className="h-5 w-5 rounded" />
                        ) : (
                          <Wallet className="h-4 w-4" />
                        )}
                        {p.info.name}
                      </button>
                    ))}
                    {(() => {
                      const fallbackEth = walletProviders.length === 0 ? getInjectedFallback() : null;
                      if (!fallbackEth) return null;
                      return (
                        <button
                          onClick={() => connectWallet()}
                          disabled={connectingWallet}
                          className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                        >
                          <Wallet className="h-4 w-4 text-cyan-300" />
                          {detectInjectedName(fallbackEth)}
                        </button>
                      );
                    })()}
                    {walletProviders.length > 0 && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        No extension? Use one of these
                      </div>
                    )}
                    <button
                      onClick={() => connectWallet(undefined, "coinbase")}
                      disabled={connectingWallet}
                      className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                    >
                      <img src="/logos/brands/coinbase-wordmark.svg" alt="" className="mt-1 h-3 w-auto shrink-0" />
                      <span>
                        <span className="block text-xs font-semibold text-slate-200">Coinbase Smart Wallet</span>
                        <span className="block text-[10px] text-slate-500">Passkey wallet in a popup — works on phones</span>
                      </span>
                    </button>
                    {walletConnectConfigured() && (
                      <button
                        onClick={() => connectWallet(undefined, "walletconnect")}
                        disabled={connectingWallet}
                        className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-800 disabled:opacity-60 cursor-pointer"
                      >
                        <Wallet className="mt-0.5 h-4 w-4 text-blue-300" />
                        <span>
                          <span className="block text-xs font-semibold text-slate-200">WalletConnect</span>
                          <span className="block text-[10px] text-slate-500">MetaMask, Trust, Rainbow & more via QR or app link</span>
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="mx-auto max-w-7xl px-4 hidden md:block xl:hidden" aria-label="Sections">
          <div className="flex overflow-x-auto gap-1.5 border-t border-slate-800/60 pt-1.5 pb-1.5">
            {SECTION_TABS
              .filter((tab) => tab.id !== "public" || studioMode)
              .map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as ActiveTab);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  aria-current={isActive ? "page" : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "bg-gradient-to-r from-[#4C6FFF] to-[#1d4ed8] text-white shadow-lg shadow-[#4C6FFF]/30 border border-blue-400/30"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {/* The badges ("10 stocks", "Agentic"…) show in the wide-screen sidebar; here they'd crowd out the links */}
                  <span>{tab.label}</span>
                </button>
              );
            })}
            <span className="ml-auto flex items-center gap-1">
              <a href="/bankr" className="whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-slate-800/60 hover:text-cyan-200">
                Bankr skill
              </a>
              <a href="/verify" className="whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                Verify
              </a>
              <a href="/stats" className="whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                Live stats
              </a>
              <a href="/faq" className="whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                FAQ
              </a>
            </span>
          </div>
        </nav>
        {/* Phones: the bottom bar holds the tabs, so the help links sit under the header */}
        <div className="md:hidden mx-auto flex max-w-7xl justify-center gap-5 px-3 pb-1.5 text-[11px] font-semibold text-slate-400">
          <a href="/bankr" className="text-cyan-300 hover:text-white">Bankr skill</a>
          <a href="/verify" className="hover:text-white">Verify</a>
          <a href="/stats" className="hover:text-white">Live stats</a>
          <a href="/faq" className="hover:text-white">FAQ</a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-3 sm:px-4 pt-2.5 sm:pt-5 pb-24 md:pb-10 space-y-3.5 sm:space-y-5">
        {/* Compact dismissible 1-line quick start (Market tab, until a wallet is connected) */}
        {activeTab === "terminal" && !walletAddress && (
          <GuidedQuickStartBar
            setActiveTab={setActiveTab}
            onQuickRunAgent={() => triggerStockAgent()}
          />
        )}

        {/* Slim status pill row (saves vertical space above the fold) */}
        <div className="hidden md:flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
          <div className="flex flex-wrap items-center gap-2.5">
            {termsAccepted === true && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                Terms accepted
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-emerald-300/90 underline hover:text-white">
                  review
                </a>
              </span>
            )}
            <span>Base Mainnet · non-custodial · you sign every order</span>
          </div>

          {hasRegistry && (
            <div className="flex items-center gap-2">
              <span className="font-semibold">Registry:</span>
              <a
                href={`https://basescan.org/address/${registryAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-cyan-500/35 bg-cyan-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition"
              >
                {registryAddress.slice(0, 8)}…{registryAddress.slice(-6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>

        {/* Global Transaction Status Banner */}
        {(txHash || txError) && (
          <div
            className={`rounded-2xl border p-4 flex items-center justify-between gap-4 backdrop-blur-md ${
              txHash
                ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
                : "border-rose-500/40 bg-rose-950/40 text-rose-200"
            }`}
          >
            <div className="flex items-center gap-3 text-xs">
              {txHash ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Onchain Transaction Broadcasted on Base Mainnet with ERC-8021 Builder Code [{builderCode}]!
                    </p>
                    <a
                      href={`https://basescan.org/tx/${txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono underline text-emerald-300 inline-flex items-center gap-1 mt-0.5"
                    >
                      View on BaseScan: {txHash} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </>
              ) : (
                <>
                  <Activity className="h-5 w-5 text-rose-400 shrink-0" />
                  <span>{txError}</span>
                </>
              )}
            </div>
            <button
              onClick={() => {
                setTxHash("");
                setTxError("");
              }}
              className="text-xs underline opacity-75 hover:opacity-100 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab !== "traction" && activeTab !== "public" && savedTarget && targetOff && targetDrift && (
          <div data-testid="target-notice" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
            {targetDrift.breaches.length > 0 ? (
              <span>
                <strong>Your {savedTarget.label} limit is broken:</strong>{" "}
                <span className="text-amber-200/80">{driftSummary(targetDrift, savedTarget.maxWeightPct)}.</span>
              </span>
            ) : (
              <span>
                <strong>Your portfolio is {targetDrift.driftPct.toFixed(targetDrift.driftPct < 10 ? 1 : 0)}% off your {savedTarget.label} target.</strong>{" "}
                <span className="text-amber-200/80">{driftSummary(targetDrift)}</span>
              </span>
            )}
            <button
              onClick={() => {
                setActiveTab("traction");
                scrollWhenReady('[data-testid="target-watch"]', "center");
              }}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-slate-950 hover:bg-amber-400 cursor-pointer"
            >
              Review
            </button>
          </div>
        )}

        {/* =====================================================================
            TAB 1: LIVE B20 EQUITIES & CHAINLINK TOTAL-RETURN ORACLE TERMINAL
           ===================================================================== */}
        {activeTab === "terminal" && (() => {
          const terminalChart = (
            <>
            <InteractiveB20TradingChart
              stocks={stocks}
              selectedSymbol={chartSelectedSymbol}
              onSelectSymbol={(sym) => setChartSelectedSymbol(sym)}
              onSendToAgent={(sym) => {
                const promptText = `Basket anchored around ${sym}, prefer stocks trading below NAV`;
                setUserPrompt(promptText);
                setActiveTab("agent");
                triggerStockAgent(stocks, promptText);
              }}
              onBuy={(st, usd, payWith) => buyStocks([{ symbol: st.symbol, b20Address: st.b20Address, usd, payWith }], st.symbol)}
              onSell={(st, tokens) => sellStocks([{ symbol: st.symbol, b20Address: st.b20Address, tokens }], st.symbol)}
              tradeUsd={tradeUsd}
              onTradeUsdChange={setTradeUsd}
              usdcBalance={usdcBalance}
              ethBalance={ethBalance}
              ethUsd={ethUsd}
              holdingTokens={walletBalances[chartSelectedSymbol]?.rawTokens ?? 0}
              avgCostUsd={
                walletAddress && pnl.for === walletAddress.toLowerCase()
                  ? pnl.data?.positions.find((p) => p.symbol === chartSelectedSymbol)?.avgCostUsd ?? null
                  : null
              }
              tradeMarkers={
                walletAddress && pnl.for === walletAddress.toLowerCase()
                  ? (pnl.data?.activity || [])
                      .filter((a): a is typeof a & { time: number } => a.symbol === chartSelectedSymbol && typeof a.time === "number")
                      .map((a) => ({ time: a.time, side: a.side, usd: a.usd }))
                  : []
              }
              walletConnected={Boolean(walletAddress)}
              pending={basketPending}
              pendingLabel={basketStatus || "Working…"}
            />
            {/* Community tokens whose pools trade against the selected stock (hidden when there are none) */}
            <PairedForStock
              symbol={chartSelectedSymbol}
              onSeeAll={(sym) => {
                setPairedFilter(sym);
                setActiveTab("paired");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
            </>
          );
          return (
          <div className="space-y-6">
            {/* Market workspace switcher: Overview (Hero + Heatmap) vs Pro Terminal (Chart + Swap immediately above fold) */}
            <div className="flex items-center justify-between gap-2">
              {/* a description only where it fits on one line; phones show just the switch */}
              <div className="hidden sm:block text-[11px] text-slate-400">
                {marketView === "terminal" ? "Pro Terminal · dual-feed chart, swap & 10-stock matrix" : "Overview · Agent quick-ask, heatmap & live market"}
              </div>
              <div className="ml-auto inline-flex rounded-xl border border-slate-800 bg-[#050914] p-0.5 text-[11px]" role="group" aria-label="Market view">
                {(
                  [
                    { id: "overview", label: "Overview" },
                    { id: "terminal", label: "Pro Terminal" },
                  ] as const
                ).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setMarketView(v.id)}
                    aria-pressed={marketView === v.id}
                    className={`whitespace-nowrap rounded-lg px-2.5 py-1 font-bold transition cursor-pointer ${
                      marketView === v.id ? "bg-[#4C6FFF] text-white" : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {marketView === "terminal" && terminalChart}

            {/* Institutional Hero Command Center + 4-Card Bento KPI Grid (Overview mode) */}
            {marketView === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5">
              <div className="lg:col-span-7 glass-panel rounded-3xl p-4 sm:p-7 relative overflow-hidden flex flex-col justify-between">
                <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#4C6FFF]/20 blur-3xl" />
                <div className="space-y-3 sm:space-y-4 relative z-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full bg-[#4C6FFF]/20 border border-[#4C6FFF]/45 px-2.5 sm:px-3 py-0.5 sm:py-1 text-[11px] sm:text-xs font-semibold text-blue-200">
                      <Layers className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                      <span>Programmable stock indexes on Base</span>
                    </span>
                  </div>

                  <h2 className="text-xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                    Build your own stock index.{" "}
                    <span className="bg-gradient-to-r from-[#60a5fa] via-cyan-300 to-emerald-300 bg-clip-text text-transparent maxx-hero-accent">
                      Buy it in one flow, from your wallet.
                    </span>
                  </h2>

                  <p className="text-xs sm:text-sm text-slate-300 leading-snug sm:leading-relaxed max-w-2xl">
                    Self-custody exposure to 10 tokenized US stocks on Base (non-US eligible, from ~$1.50). Ask the agent
                    for a transparent, source-backed basket — no wallet needed to try.
                  </p>

                  {/* Try the agent right here: no wallet, the result opens on the Agent tab */}
                  <form
                    data-testid="hero-ask"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const text = heroPrompt.trim();
                      if (!text) return;
                      setUserPrompt(text);
                      setActiveTab("agent");
                      triggerStockAgent(stocks, text);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="space-y-2"
                  >
                    <div className="flex gap-2">
                      <input
                        id="hero-prompt-input"
                        name="heroPrompt"
                        value={heroPrompt}
                        onChange={(e) => setHeroPrompt(e.target.value.slice(0, 300))}
                        placeholder='e.g. "Chips & cloud, max 25%, 15% cash"'
                        aria-label="What do you want the agent to build?"
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 sm:py-2.5 text-xs sm:text-sm text-white placeholder-slate-500 focus:border-[#4C6FFF] focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!hydrated}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-3 sm:px-3.5 py-2 sm:py-2.5 text-xs font-bold text-white hover:opacity-95 cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="h-4 w-4" />
                        Ask
                      </button>
                    </div>
                    <div className="flex flex-nowrap overflow-x-auto pb-0.5 sm:pb-0 sm:overflow-visible sm:flex-wrap gap-1.5">
                      {[
                        "Chips and cloud plus Palantir, nothing above 25%, keep 15% in cash",
                        "Big tech, no crypto, equal weight",
                        "60% Nvidia, max 25% per stock",
                      ].map((ex) => (
                        <button
                          key={ex}
                          type="button"
                          onClick={() => setHeroPrompt(ex)}
                          className="shrink-0 whitespace-nowrap sm:whitespace-normal rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-left text-[10px] leading-snug text-slate-300 hover:border-[#4C6FFF] hover:text-white cursor-pointer"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </form>
                </div>

                <div className="mt-3.5 pt-3.5 sm:mt-6 sm:pt-5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2 py-0.5 pl-0.5">
                      {BASE_TOKENIZED_STOCKS.map((st) => (
                        <img
                          key={st.symbol}
                          src={st.logoUrl}
                          alt={st.companyName}
                          title={`${st.companyName} (${st.symbol})`}
                          className="inline-block h-6 w-6 sm:h-7 sm:w-7 rounded-full maxx-avatar-ring bg-slate-900 object-cover"
                        />
                      ))}
                    </div>
                    <span className="text-[11px] sm:text-xs text-slate-400 font-medium pl-1">
                      10 Live B20 Equities
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={() => setActiveTab("agent")}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition cursor-pointer"
                    >
                      <Bot className="h-3.5 w-3.5" />
                      Ask the agent
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab("indexes");
                        scrollWhenReady("#index-builder", "start");
                      }}
                      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:brightness-110 transition cursor-pointer"
                    >
                      <Layers className="h-4 w-4" />
                      Build an index
                    </button>
                  </div>
                </div>
              </div>

              {/* Right 2x2 Glassmorphic Telemetry Bento Grid */}
              {/* Hidden on phones: keeps the chart and swap panel near the top there */}
              <div className="lg:col-span-5 hidden sm:grid grid-cols-2 gap-4">
                <div className="glass-panel glass-panel-hover rounded-2xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">US market</span>
                    <span className="text-[10px] font-mono text-slate-500">New York</span>
                  </div>
                  <div className="my-2 text-xs leading-relaxed">
                    <MarketStatus showDetail className="flex-wrap" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                    NAV 24/5 · DEX 24/7
                  </div>
                </div>

                <div className="glass-panel glass-panel-hover rounded-2xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Verifiable</span>
                  </div>
                  <div className="my-2">
                    <div className="font-mono text-xl font-extrabold text-cyan-300">Open source</div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      Every trade routed by MAXXAGENT is public onchain and counted on the live stats page.
                    </div>
                  </div>
                  <div className="flex gap-3 text-[10px] font-mono border-t border-slate-800/80 pt-2">
                    <a href="/stats" className="text-cyan-400 hover:underline">Live stats</a>
                    <a href="/verify" className="text-cyan-400 hover:underline">How to verify</a>
                    <a href="https://github.com/0xAxelowETH/maxxagent" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">
                      GitHub
                    </a>
                  </div>
                </div>

                <div className="glass-panel glass-panel-hover rounded-2xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      ERC-8056 Multipliers
                    </span>
                  </div>
                  <div className="my-2 space-y-1 font-mono text-xs">
                    {(stocks.length > 0
                      ? [...stocks].sort((a, b) => b.uiMultiplier - a.uiMultiplier).slice(0, 3)
                      : []
                    ).map((st) => (
                      <div key={st.symbol} className="flex justify-between">
                        <span className="text-slate-300">{st.symbol}:</span>
                        <span className="text-emerald-400 font-bold">{st.uiMultiplier.toFixed(6)}x</span>
                      </div>
                    ))}
                    {stocks.length === 0 && <div className="text-slate-500">Loading live multipliers…</div>}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                    Live · dividends &amp; splits
                  </div>
                </div>

                <div className="glass-panel glass-panel-hover rounded-2xl p-4 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      How you buy
                    </span>
                    <MaxxAgentMark size={20} />
                  </div>
                  <div className="my-2">
                    <div className="font-mono text-xl font-extrabold text-emerald-300">Non-custodial</div>
                    <div className="text-[11px] text-slate-300 mt-0.5">
                      USDC or ETH → stocks in one flow (1 confirmation on EIP-5792 smart wallets; step-by-step on standard wallets). Cost quoted live; routes over 1.5% refused.
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                    Stocks go straight to your wallet
                  </div>
                </div>
              </div>
            </div>
            )}

            {stocks.length > 0 && <MarketHeatmap stocks={stocks} updatedAt={fetchedAt} />}

            {/* Below-NAV Discount Radar (only live DEX quotes; falls back to tightest NAV spreads when all trade >= NAV) */}
            {(() => {
              // Only stocks with both a live DEX quote and a readable NAV: the API reports a 0% gap when the NAV
              // couldn't be read, which must never show up as the "best" spread next to a buy button
              const liveQuoted = stocks.filter(
                (s) =>
                  s.dexPriceSource !== "onchain-nav-model" &&
                  s.source !== "fallback-snapshot" &&
                  !(s.isOracleStale && (s.weekendGapPct ?? 0) === 0)
              );
              // Same threshold as the API's BUY_DEX_DISCOUNT signal
              const discounts = liveQuoted
                .filter((s) => (s.weekendGapPct ?? 0) <= -0.15)
                .sort((a, b) => (a.weekendGapPct ?? 0) - (b.weekendGapPct ?? 0));
              const hasDiscounts = discounts.length > 0;
              const radar = (
                hasDiscounts
                  ? discounts
                  : [...liveQuoted].sort((a, b) => Math.abs(a.weekendGapPct ?? 0) - Math.abs(b.weekendGapPct ?? 0))
              ).slice(0, 4);
              if (radar.length === 0) return null;
              const marketOpen = usMarketStatus().state === "open";
              return (
                <section
                  aria-label={hasDiscounts ? "Below-NAV Discount Radar" : "DEX vs NAV spreads"}
                  data-testid="below-nav-strip"
                  className={`rounded-2xl border p-4 ${hasDiscounts ? "border-emerald-500/30 bg-emerald-500/5" : "border-slate-800 bg-[#070b14]/60"}`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-white">
                        {hasDiscounts ? "Below-NAV Discount Radar" : "Tightest DEX vs NAV Spreads"}
                      </h3>
                      <span className="rounded-md border border-emerald-500/35 bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                        24/7 Radar
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      {marketOpen
                        ? "Live DEX prices compared against Chainlink NAV. Exact quote shown before signing."
                        : "US market is closed: NAV holds last close while DEX moves 24/7."}{" "}
                      Not advice.
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                    {radar.map((s) => {
                      const gap = s.weekendGapPct ?? 0;
                      const liq = s.dexLiquidityUsd
                        ? s.dexLiquidityUsd >= 1e6
                          ? `$${(s.dexLiquidityUsd / 1e6).toFixed(1)}M liq`
                          : `$${Math.round(s.dexLiquidityUsd / 1e3)}K liq`
                        : "Live pool";
                      return (
                        <div key={s.symbol} className="flex items-center justify-between gap-2 rounded-xl border border-slate-800 bg-[#070b14] px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <img src={s.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full border border-slate-700 bg-slate-900 object-cover" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-xs font-bold text-white">{s.symbol}</span>
                                <span className={`font-mono text-[10px] font-bold ${gap < 0 ? "text-emerald-300" : gap > 0 ? "text-amber-300" : "text-slate-300"}`}>
                                  {gap === 0 ? "at NAV" : `${Math.abs(gap).toFixed(2)}% ${gap < 0 ? "below" : "above"} NAV`}
                                </span>
                              </div>
                              <div className="font-mono tabular-nums text-[10px] text-slate-400 truncate">
                                DEX ${s.dexPrice24_7.toFixed(2)} · {liq}
                              </div>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setChartSelectedSymbol(s.symbol);
                                document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }}
                              className="inline-flex min-h-[30px] items-center rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-semibold text-slate-200 hover:border-[#4C6FFF] hover:text-white cursor-pointer"
                              aria-label={`Select ${s.symbol} in Swap`}
                            >
                              Swap
                            </button>
                            {hasDiscounts && (
                              <button
                                type="button"
                                disabled={basketPending}
                                onClick={() => buyStocks([{ symbol: s.symbol, b20Address: s.b20Address, usd: 5, payWith: "usdc" }], s.symbol)}
                                className="inline-flex min-h-[30px] items-center gap-0.5 rounded-lg bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                                aria-label={`Quick buy $5 of ${s.symbol}`}
                              >
                                <Zap className="h-2.5 w-2.5" />
                                $5
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })()}

            {/* Spotlight B20 Equity Bento Cards (Overview mode; phones use chart's stock picker) */}
            {marketView === "overview" && (
            <div className="hidden sm:grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(stocks.length > 0 ? stocks.slice(0, 4) : []).map((stock) => {
                const isPos = stock.change24hPct >= 0;
                const isChartActive = chartSelectedSymbol === stock.symbol;
                return (
                  <div
                    key={stock.symbol}
                    className={`glass-panel glass-panel-hover rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between ${
                      isChartActive ? "ring-2 ring-[#4C6FFF]/80" : ""
                    }`}
                  >
                    <div
                      className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl"
                      style={{ backgroundColor: stock.color }}
                    />
                    <button
                      type="button"
                      onClick={() => setChartSelectedSymbol(stock.symbol)}
                      className="text-left w-full cursor-pointer group"
                      title={`Load ${stock.symbol} in chart`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                          <div className="relative h-10 w-10 shrink-0">
                            <img
                              src={stock.logoUrl}
                              alt={stock.companyName}
                              className="h-10 w-10 rounded-full border border-slate-700 bg-slate-900 object-cover shadow-md"
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-sm font-extrabold text-white group-hover:text-cyan-200 transition">
                                {stock.symbol}
                              </span>
                              {stock.uiMultiplier > 1.00001 && (
                                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-mono tabular-nums text-[9px] font-bold text-emerald-300">
                                  {stock.uiMultiplier.toFixed(4)}x
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate max-w-[130px]">
                              {stock.companyName}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`rounded-lg px-2 py-0.5 font-mono tabular-nums text-[11px] font-bold ${
                            isPos
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                          }`}
                        >
                          {isPos ? "+" : ""}
                          {stock.change24hPct.toFixed(2)}%
                        </span>
                      </div>

                      <div className="my-3">
                        <StockSparkline color={stock.color} symbol={stock.symbol} />
                      </div>

                      <div className="flex items-end justify-between border-t border-slate-800/80 pt-2.5">
                        <div>
                          <div className="text-[10px] uppercase text-slate-400 font-semibold">
                            Chainlink NAV
                          </div>
                          <div className="font-mono tabular-nums text-lg font-extrabold text-white">
                            ${stock.navPrice.toFixed(2)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-slate-400 font-semibold">
                            DEX price 24/7
                          </div>
                          <div className="font-mono tabular-nums text-xs font-bold text-cyan-300">
                            ${stock.dexPrice24_7.toFixed(2)}{" "}
                            <span className="text-[10px] text-slate-400">
                              ({stock.weekendGapPct >= 0 ? "+" : ""}
                              {stock.weekendGapPct.toFixed(2)}%)
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>

                    <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-center justify-between gap-2">
                      <button
                        onClick={() => {
                          setChartSelectedSymbol(stock.symbol);
                          document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        className="flex-1 inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg bg-[#4C6FFF]/20 hover:bg-[#4C6FFF]/35 border border-[#4C6FFF]/45 px-2.5 py-1.5 text-[11px] font-bold text-blue-200 transition cursor-pointer"
                        title={`Buy or sell ${stock.symbol}: choose any amount in the Swap panel`}
                      >
                        <Zap className="h-3 w-3" />
                        Trade {stock.symbol}
                      </button>
                      <a
                        href={`/stock/${stock.symbol}`}
                        className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white transition"
                        title={`${stock.symbol}: live NAV, DEX price, chart and token details`}
                      >
                        Details
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            )}

            {/* Real price history: Chainlink NAV vs DEX (Overview mode position) */}
            {marketView === "overview" && terminalChart}

            {/* Live Tokenized Stocks Table with Official Stock Logos */}
            <div className="glass-panel rounded-3xl overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      Tokenized stocks on Base · live NAV and DEX prices
                    </h3>
                    <p className="text-xs text-slate-400">
                      Last synced from Base Mainnet RPC:{" "}
                      <span className="font-mono text-slate-300">
                        {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : "Syncing..."}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-1 font-mono text-emerald-300">
                    Dividend-Adjusted Multiplier Active (AAPLc, NVDAc, METAc, GOOGLc &gt; 1.000x)
                  </span>
                </div>
              </div>

              {/* Search, Sector Filter & Signal Filter Toolbar */}
              <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 border-b border-slate-800/80 bg-[#050a18]/80 px-6 py-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search ticker (NVDAc), company (SpaceX), or ISIN..."
                    className="w-full rounded-xl border border-slate-700/80 bg-[#030712] pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-[#4C6FFF] focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={selectedSectorFilter}
                    onChange={(e) => setSelectedSectorFilter(e.target.value)}
                    className="rounded-xl border border-slate-700/80 bg-[#030712] px-3 py-1.5 text-xs text-slate-200 focus:border-[#4C6FFF] focus:outline-none"
                  >
                    <option value="ALL">All Sectors (10)</option>
                    <option value="AI & Semiconductors">AI & Semiconductors</option>
                    <option value="Big Tech Cloud">Big Tech Cloud</option>
                    <option value="Frontier & Crypto">Frontier & Crypto</option>
                    <option value="Consumer & Hardware">Consumer & Hardware</option>
                  </select>

                  {[
                    { id: "ALL", label: "All Stocks" },
                    { id: "DIVIDEND", label: "Dividend Boosted (>1.000x)" },
                    { id: "DISCOUNT", label: "Below NAV" },
                  ].map((sig) => (
                    <button
                      key={sig.id}
                      onClick={() => setSelectedSignalFilter(sig.id)}
                      className={`rounded-xl px-2.5 py-1.5 text-[11px] font-semibold transition cursor-pointer border ${
                        selectedSignalFilter === sig.id
                          ? "bg-[#4C6FFF]/25 text-blue-200 border-[#4C6FFF]/50"
                          : "bg-[#030712] text-slate-400 border-slate-800 hover:text-white"
                      }`}
                    >
                      {sig.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phones: one compact row per stock (the full table needs a wide screen) */}
              <div className="md:hidden divide-y divide-slate-800/60">
                {filteredStocks.map((stock) => {
                  const bal = walletBalances[stock.symbol];
                  const gap = stock.weekendGapPct ?? 0;
                  return (
                    <div key={stock.symbol} className="flex items-center gap-3 px-4 py-3">
                      <img src={stock.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-slate-700 bg-slate-900 object-cover" />
                      <a href={`/stock/${stock.symbol}`} className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-sm font-bold text-white">{stock.symbol}</span>
                          <span className="truncate text-[11px] text-slate-400">{stock.companyName}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                          <span className={`font-mono ${stock.change24hPct >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {stock.change24hPct >= 0 ? "+" : ""}
                            {stock.change24hPct.toFixed(2)}%
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              gap <= -0.05 ? "bg-emerald-500/15 text-emerald-300" : gap >= 0.05 ? "bg-amber-500/15 text-amber-300" : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {gap <= -0.05 ? `${Math.abs(gap).toFixed(2)}% below NAV` : gap >= 0.05 ? `${gap.toFixed(2)}% above NAV` : "at NAV"}
                          </span>
                          {(bal?.rawTokens ?? 0) > 0 && <span className="text-cyan-300">You: ${(bal?.usdValue ?? 0).toFixed(2)}</span>}
                        </div>
                      </a>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-sm font-bold text-white">${stock.navPrice.toFixed(2)}</div>
                        <button
                          onClick={() => {
                            setChartSelectedSymbol(stock.symbol);
                            document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                          }}
                          className="mt-1 inline-flex items-center gap-1 rounded-md border border-[#4C6FFF]/50 bg-[#4C6FFF]/20 px-2.5 py-1 text-[11px] font-bold text-blue-200 cursor-pointer"
                          aria-label={`Buy or sell ${stock.symbol}`}
                        >
                          <Zap className="h-3 w-3" />
                          Trade
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 bg-[#070b14] text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      <th className="py-3.5 px-4">Asset / ISIN</th>
                      <th className="py-3.5 px-4">Sector</th>
                      <th className="py-3.5 px-4 text-right">
                        <button type="button" onClick={() => toggleSort("nav")} className="inline-flex items-center gap-1 hover:text-white cursor-pointer">
                          Chainlink 24/5 NAV
                          {tableSort.col === "nav" && <span>{tableSort.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                        <button type="button" onClick={() => toggleSort("change")} className="ml-1.5 text-[10px] text-cyan-400 hover:text-white cursor-pointer" title="Sort by 24h change">
                          24h{tableSort.col === "change" ? (tableSort.dir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-3.5 px-4 text-right">
                        <button type="button" onClick={() => toggleSort("gap")} className="inline-flex items-center gap-1 hover:text-white cursor-pointer">
                          24/7 DEX vs Gap
                          {tableSort.col === "gap" && <span>{tableSort.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                        <button type="button" onClick={() => toggleSort("vol")} className="ml-1.5 text-[10px] text-cyan-400 hover:text-white cursor-pointer" title="Sort by 24h DEX volume">
                          Vol{tableSort.col === "vol" ? (tableSort.dir === "asc" ? "▲" : "▼") : ""}
                        </button>
                      </th>
                      <th className="py-3.5 px-4 text-right">
                        <button type="button" onClick={() => toggleSort("mult")} className="inline-flex items-center gap-1 hover:text-white cursor-pointer">
                          B20 Multiplier
                          {tableSort.col === "mult" && <span>{tableSort.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      </th>
                      <th className="py-3.5 px-4 text-right">Onchain Supply (Shares UI)</th>
                      <th className="py-3.5 px-4 text-right">
                        <button type="button" onClick={() => toggleSort("mcap")} className="inline-flex items-center gap-1 hover:text-white cursor-pointer">
                          Base Market Cap
                          {tableSort.col === "mcap" && <span>{tableSort.dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      </th>
                      {Object.keys(walletBalances).length > 0 && (
                        <th className="py-3.5 px-4 text-right text-cyan-400">Wallet balanceOfUI</th>
                      )}
                      <th className="py-3.5 px-4 text-center">Actions &amp; sources</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-xs">
                    {filteredStocks.map((stock) => {
                      const hasDividendBoost = stock.uiMultiplier > 1.00001;
                      const bal = walletBalances[stock.symbol];
                      const isRowSelected = chartSelectedSymbol === stock.symbol;
                      return (
                        <tr
                          key={stock.symbol}
                          onClick={() => setChartSelectedSymbol(stock.symbol)}
                          className={`hover:bg-slate-800/40 transition-colors group cursor-pointer ${
                            isRowSelected ? "bg-[#4C6FFF]/10" : ""
                          }`}
                        >
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-3">
                              {/* Official Coinbase Tokenized Stock Logo + Base Badge */}
                              <div className="relative h-10 w-10 shrink-0">
                                <img
                                  src={stock.logoUrl}
                                  alt={stock.companyName}
                                  className="h-10 w-10 rounded-full border border-slate-700 bg-slate-900 object-cover shadow-md"
                                />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <a
                                    href={`/stock/${stock.symbol}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="font-bold text-white text-sm hover:text-cyan-300 hover:underline"
                                    title={`${stock.symbol} details`}
                                  >
                                    {stock.companyName}
                                  </a>
                                  <span
                                    className="rounded px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
                                    style={{ backgroundColor: stock.color }}
                                  >
                                    {stock.symbol}
                                  </span>
                                </div>
                                <div className="font-mono text-[11px] text-slate-400">
                                  ISIN: {stock.isin}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4">
                            <span className="inline-block whitespace-nowrap rounded-full bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">
                              {stock.sector}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                            <div className="inline-flex items-center justify-end gap-1.5 text-sm font-bold text-white">
                              ${stock.navPrice.toFixed(2)}
                            </div>
                            <div
                              className={`text-[11px] font-medium whitespace-nowrap ${
                                stock.change24hPct >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {stock.change24hPct >= 0 ? "+" : ""}
                              {stock.change24hPct.toFixed(2)}%
                            </div>
                            <div className="text-[10px] text-slate-500 whitespace-nowrap">
                              {fmtAge(stock.oracleAgeMinutes ?? 3)} ago
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono tabular-nums">
                            <div className="text-xs font-bold text-slate-200">
                              DEX: ${(stock.dexPrice24_7 ?? stock.navPrice).toFixed(2)} (
                              {(stock.weekendGapPct ?? 0) >= 0 ? "+" : ""}
                              {(stock.weekendGapPct ?? 0).toFixed(2)}%)
                            </div>
                            <div className="flex flex-wrap items-center justify-end gap-1.5 mt-0.5">
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  stock.weekendSignal === "BUY_DEX_DISCOUNT"
                                    ? "bg-emerald-500/20 text-emerald-300"
                                    : stock.weekendSignal === "SHORT_DEX_PREMIUM"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-slate-800 text-slate-400"
                                }`}
                              >
                                {stock.weekendSignal === "BUY_DEX_DISCOUNT"
                                  ? "Below NAV"
                                  : stock.weekendSignal === "SHORT_DEX_PREMIUM"
                                  ? "Above NAV"
                                  : "At NAV"}
                              </span>
                              {stock.dexVolume24hUsd && (
                                <span className="text-[10px] text-slate-400" title="24h Base DEX Volume">
                                  ${stock.dexVolume24hUsd >= 1e6 ? `${(stock.dexVolume24hUsd / 1e6).toFixed(1)}M` : `${(stock.dexVolume24hUsd / 1e3).toFixed(0)}K`} vol
                                </span>
                              )}
                              {stock.dexLiquidityUsd && (
                                <a
                                  href={stock.dexUrl || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[10px] text-cyan-400 hover:underline"
                                  title="Live Base DEX Pool Liquidity"
                                >
                                  ${stock.dexLiquidityUsd >= 1e6 ? `${(stock.dexLiquidityUsd / 1e6).toFixed(1)}M` : `${(stock.dexLiquidityUsd / 1e3).toFixed(0)}K`} liq
                                </a>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ${
                                hasDividendBoost
                                  ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                                  : "bg-slate-800/80 text-slate-300"
                              }`}
                            >
                              {stock.uiMultiplier.toFixed(6)}x
                            </span>
                            {hasDividendBoost && (
                              <div className="text-[10px] text-emerald-400 mt-0.5">
                                Dividend Reinvested
                              </div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono">
                            <div className="text-slate-200 font-medium">
                              {stock.totalSupplySharesUI.toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}{" "}
                              sh
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Raw:{" "}
                              {stock.totalSupplyTokens.toLocaleString("en-US", {
                                maximumFractionDigits: 2,
                              })}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono font-semibold text-white">
                            ${(stock.onchainMarketCapUsd / 1e6).toFixed(2)}M
                          </td>
                          {Object.keys(walletBalances).length > 0 && (
                            <td className="py-3.5 px-4 text-right font-mono">
                              <div className="text-cyan-300 font-semibold">
                                {(bal?.sharesUI ?? 0).toFixed(4)} sh
                              </div>
                              <div className="text-[10px] text-slate-400">
                                ${(bal?.usdValue ?? 0).toFixed(2)}
                              </div>
                            </td>
                          )}
                          <td className="py-3.5 px-4">
                            <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChartSelectedSymbol(stock.symbol);
                                  document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                }}
                                title={`Buy or sell ${stock.symbol}: choose any amount in the Swap panel`}
                                className="inline-flex items-center gap-1 rounded-md border border-[#4C6FFF]/50 bg-[#4C6FFF]/20 px-2.5 py-1 text-[11px] font-bold text-blue-200 hover:bg-[#4C6FFF]/35 disabled:opacity-60 transition cursor-pointer"
                              >
                                <Zap className="h-3 w-3" />
                                Buy
                              </button>
                              <a
                                href={`/stock/${stock.symbol}`}
                                onClick={(e) => e.stopPropagation()}
                                title={`Open ${stock.symbol} dossier`}
                                className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:border-cyan-400/50 hover:text-white transition"
                              >
                                Inspect
                              </a>
                              <button
                                type="button"
                                onMouseDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const r = e.currentTarget.getBoundingClientRect();
                                  const right = Math.max(8, window.innerWidth - r.right);
                                  const upward = window.innerHeight - r.bottom < 140 && r.top > 140;
                                  setOpenSourcesMenu((cur) =>
                                    cur?.symbol === stock.symbol
                                      ? null
                                      : {
                                          symbol: stock.symbol,
                                          right,
                                          top: r.bottom + 6,
                                          bottom: window.innerHeight - r.top + 6,
                                          upward,
                                        }
                                  );
                                }}
                                aria-expanded={openSourcesMenu?.symbol === stock.symbol}
                                aria-haspopup="menu"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition cursor-pointer select-none"
                                title="B20 contract, Chainlink feed & prospectus links"
                              >
                                Sources
                                <ChevronDown className={`h-3 w-3 opacity-70 transition ${openSourcesMenu?.symbol === stock.symbol ? "rotate-180" : ""}`} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {openSourcesMenu && (() => {
                const openStock = filteredStocks.find((s) => s.symbol === openSourcesMenu.symbol);
                if (!openStock) return null;
                return (
                  <div
                    role="menu"
                    onMouseDown={(e) => e.stopPropagation()}
                    style={
                      openSourcesMenu.upward
                        ? { bottom: openSourcesMenu.bottom, right: openSourcesMenu.right }
                        : { top: openSourcesMenu.top, right: openSourcesMenu.right }
                    }
                    className="fixed z-50 w-40 rounded-xl border border-slate-700 bg-[#0b1120] p-1.5 shadow-2xl space-y-1 text-left"
                  >
                    <a
                      role="menuitem"
                      href={openStock.basescanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpenSourcesMenu(null)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 font-mono text-[11px] text-slate-200 hover:bg-slate-800"
                    >
                      <span>B20 contract</span>
                      <ExternalLink className="h-3 w-3 text-slate-400" />
                    </a>
                    <a
                      role="menuitem"
                      href={`https://basescan.org/address/${openStock.chainlinkFeed}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpenSourcesMenu(null)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] text-cyan-300 hover:bg-slate-800"
                    >
                      <span>Chainlink feed</span>
                      <ExternalLink className="h-3 w-3 text-cyan-400/80" />
                    </a>
                    <a
                      role="menuitem"
                      href={openStock.prospectusUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setOpenSourcesMenu(null)}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] text-amber-300 hover:bg-slate-800"
                    >
                      <span>Prospectus PDF</span>
                      <FileText className="h-3 w-3 text-amber-300/80" />
                    </a>
                  </div>
                );
              })()}
            </div>

            {/* Learning material kept out of the way: glossary + dividend/split multiplier simulator */}
            <details className="group glass-panel rounded-3xl p-4 sm:p-5" id="learn-more">
              <summary className="cursor-pointer list-none flex items-center justify-between gap-3 text-sm font-bold text-white">
                <span>
                  Learn more: glossary &amp; dividend / split simulator
                  <span className="block text-[11px] font-normal text-slate-400">
                    NAV, multiplier, B20 and how dividends and splits change what one token is worth.
                  </span>
                </span>
                <span className="text-slate-500 transition group-open:rotate-45 text-lg">+</span>
              </summary>
              <div className="mt-4 space-y-6">
                <PlainEnglishGlossaryStrip />
                <B20DividendSplitSimulator stocks={stocks} />
              </div>
            </details>
          </div>
          );
        })()}

        {/* =====================================================================
            TAB 2: BASKET AGENT (AGENTIC STOCK FINANCE)
           ===================================================================== */}
        {activeTab === "agent" && (
          <AgentTab
            publicSiteUrl={PUBLIC_SITE_URL}
            stocks={stocks}
            userPrompt={userPrompt}
            setUserPrompt={setUserPrompt}
            riskProfile={riskProfile}
            setRiskProfile={setRiskProfile}
            capitalUsd={capitalUsd}
            setCapitalUsd={setCapitalUsd}
            runningAgent={runningAgent}
            agentError={agentError}
            agentReport={agentReport}
            mandateHistory={mandateHistory}
            followUpPrompt={followUpPrompt}
            setFollowUpPrompt={setFollowUpPrompt}
            triggerStockAgent={triggerStockAgent}
            basketUsd={basketUsd}
            setBasketUsd={setBasketUsd}
            basketPayWith={basketPayWith}
            payLabel={payLabel}
            payToggle={payToggle}
            basketPending={basketPending}
            basketStatus={basketStatus}
            basketError={basketError}
            basketResult={basketResult}
            buyStocks={buyStocks}
            sellStocks={sellStocks}
            savedTarget={savedTarget}
            saveTarget={saveTarget}
            walletAddress={walletAddress}
            balancesFor={balancesFor}
            walletBalances={walletBalances}
            usdcBalance={usdcBalance}
            rebalanceBuyDoneNonce={rebalanceBuyDoneNonce}
            rebalanceUsdcBaseline={rebalanceUsdcBaseline}
            highlightedAlloc={highlightedAlloc}
            setHighlightedAlloc={setHighlightedAlloc}
            copiedKey={copiedKey}
            copyToClipboard={copyToClipboard}
            shareLinkFor={shareLinkFor}
            hasRegistry={hasRegistry}
            txPending={txPending}
            publishStatus={publishStatus}
            publishIndexOnchain={publishIndexOnchain}
            studioMode={studioMode}
            proMode={proMode}
            setProMode={setProMode}
          />
        )}

        {/* =====================================================================
            TAB 3: NON-CUSTODIAL INDEX REGISTRY
           ===================================================================== */}
        {/* News & filings for the supported stocks, with the price change since each item was published */}
        {activeTab === "news" && (
          <div className="space-y-4" data-testid="news-tab">
            <NewsFeed
              limit={15}
              title="News & filings"
              onTrade={(sym) => {
                setChartSelectedSymbol(sym);
                setActiveTab("terminal");
                scrollWhenReady("#swap-panel", "center");
              }}
              onAsk={(prompt) => {
                setUserPrompt(prompt);
                setActiveTab("agent");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />
          </div>
        )}

        {/* Third-party tokens whose pools trade against the tokenized stocks (read-only, never routed) */}
        {activeTab === "paired" && (
          <PairedTab
            stocks={stocks}
            initialStock={pairedFilter || undefined}
            onTrade={(sym) => {
              setChartSelectedSymbol(sym);
              setActiveTab("terminal");
              scrollWhenReady("#swap-panel", "center");
            }}
          />
        )}

        {activeTab === "indexes" && (
          <IndexesTab
            publicSiteUrl={PUBLIC_SITE_URL}
            stocks={stocks}
            selectedPreset={selectedPreset}
            setSelectedPreset={setSelectedPreset}
            customIndexName={customIndexName}
            setCustomIndexName={setCustomIndexName}
            customIndexTicker={customIndexTicker}
            setCustomIndexTicker={setCustomIndexTicker}
            customWeights={customWeights}
            setCustomWeights={setCustomWeights}
            applyCustomWeights={applyCustomWeights}
            builderView={builderView}
            setBuilderView={setBuilderView}
            builderPinned={builderPinned}
            setBuilderPinned={setBuilderPinned}
            normalizeCustomWeights={normalizeCustomWeights}
            equalizeCustomWeights={equalizeCustomWeights}
            clearCustomWeights={clearCustomWeights}
            totalCustomWeightBps={totalCustomWeightBps}
            sharedBasketLoaded={sharedBasketLoaded}
            setSharedBasketLoaded={setSharedBasketLoaded}
            basketUsd={basketUsd}
            setBasketUsd={setBasketUsd}
            basketPayWith={basketPayWith}
            payLabel={payLabel}
            payToggle={payToggle}
            amountControl={amountControl}
            basketPending={basketPending}
            basketStatus={basketStatus}
            buyStocks={buyStocks}
            hasRegistry={hasRegistry}
            registryAddress={registryAddress}
            txPending={txPending}
            publishStatus={publishStatus}
            publishIndexOnchain={publishIndexOnchain}
            publishedIndexes={publishedIndexes}
            indexesStatus={indexesStatus}
            loadPublishedIndexes={loadPublishedIndexes}
            indexBuys={indexBuys}
            indexSort={indexSort}
            setIndexSort={setIndexSort}
            copiedKey={copiedKey}
            copyToClipboard={copyToClipboard}
            shareLinkFor={shareLinkFor}
          />
        )}

        {/* =====================================================================
            TAB 4: ERC-8021 BUILDER CODE & ONCHAIN TRACTION LAB (50% JUDGING WEIGHT)
           ===================================================================== */}
        {activeTab === "traction" && (
          <PortfolioTab
            walletAddress={walletAddress}
            stocks={stocks}
            loadingStocks={loadingStocks}
            balancesFor={balancesFor}
            balancesError={balancesError}
            walletBalances={walletBalances}
            usdcBalance={usdcBalance}
            ethBalance={ethBalance}
            ethUsd={ethUsd}
            pnl={pnl}
            savedTarget={savedTarget}
            targetDrift={targetDrift}
            targetReady={targetReady}
            rebalanceLog={rebalanceLog}
            rebalanceBuyDoneNonce={rebalanceBuyDoneNonce}
            rebalanceUsdcBaseline={rebalanceUsdcBaseline}
            basketPending={basketPending}
            activityLog={activityLog}
            demoPortfolio={demoPortfolio}
            setDemoPortfolio={setDemoPortfolio}
            demoActionMsg={demoActionMsg}
            setDemoActionMsg={setDemoActionMsg}
            onClearActivityLog={() => {
              setActivityLog([]);
              try {
                window.localStorage.removeItem("maxxagent_activity_log");
              } catch {}
            }}
            onRefreshStocks={(w) => fetchLiveStocks(w)}
            onOpenWalletMenu={() => setShowWalletMenu(true)}
            onSaveTarget={saveTarget}
            onBuyStocks={buyStocks}
            onSellStocks={sellStocks}
            onGoToTerminal={(sym) => {
              if (sym) {
                setChartSelectedSymbol(sym);
                setActiveTab("terminal");
                scrollWhenReady("#swap-panel", "center");
              } else {
                setActiveTab("terminal");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }
            }}
            onGoToAgent={() => setActiveTab("agent")}
          />
        )}

        {/* =====================================================================
            TAB 5: BUILD IN PUBLIC & SUBMISSION
           ===================================================================== */}
        {activeTab === "public" && (
          <PublicAttributionTab
            builderCode={builderCode}
            attributedCalldata={agentReport?.onchainExecution.attributedCalldata}
            copiedKey={copiedKey}
            copyToClipboard={copyToClipboard}
            stocks={stocks}
            totalTvlUsd={totalTvlUsd}
            dayNumber={studioDay}
            setDayNumber={setStudioDay}
            milestoneTitle={studioMilestone}
            setMilestoneTitle={setStudioMilestone}
          />
        )}
      </main>

      {/* Screen-reader announcements for order progress and outcomes */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {basketPending
          ? basketStatus || "Working"
          : basketError
          ? `Order not completed. ${basketError}`
          : basketResult
          ? basketResult.failed?.length
            ? "Order partly completed."
            : basketResult.side === "sell"
            ? "Sale confirmed."
            : "Purchase confirmed."
          : txError || ""}
      </div>

      {review && (
        <OrderReview
          order={review.order}
          label={review.label}
          ttlMs={QUOTE_TTL_MS}
          busy={reviewBusy}
          status={basketStatus}
          onConfirm={confirmReview}
          onCancel={() => setReview(null)}
          onRefresh={() => refreshReview()}
          slippageBps={slippageBps}
          onSlippageChange={(bps) => refreshReview(bps)}
        />
      )}

      {/* Purchase status toast (visible from any tab, including final result on Agent tab on mobile) */}
      {(basketPending || basketError || basketResult) && (
        <div
          data-testid="basket-status-toast"
          className="fixed bottom-24 md:bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 z-50 rounded-2xl border border-slate-700 bg-[#0b1120]/95 p-4 text-xs shadow-2xl backdrop-blur space-y-2"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 font-bold text-white min-w-0">
              {basketPending && <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-cyan-400" />}
              <span className="truncate">
                {basketPending ? basketStatus || "Working…" : basketError ? "Order not completed" : basketResult?.failed?.length ? "Partly completed" : basketResult?.side === "sell" ? "Sale confirmed" : "Purchase confirmed"}
              </span>
            </div>
            {basketPending && basketStep && basketStep.total > 1 ? (
              <span
                data-testid="basket-step-counter"
                className="shrink-0 rounded-full border border-cyan-500/40 bg-cyan-500/15 px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums text-cyan-200"
              >
                Step {basketStep.step}/{basketStep.total}
              </span>
            ) : !basketPending ? (
              <button
                onClick={() => {
                  setBasketError("");
                  setBasketResult(null);
                }}
                className="text-slate-400 hover:text-white cursor-pointer"
                aria-label="Dismiss"
              >
                ✕
              </button>
            ) : null}
          </div>
          {basketPending && (
            <div className="space-y-1.5" data-testid="basket-step-progress">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={
                    basketStep && basketStep.total > 0
                      ? "h-full rounded-full bg-gradient-to-r from-[#4C6FFF] via-cyan-400 to-emerald-400 transition-all duration-300"
                      : "h-full w-1/3 rounded-full bg-cyan-400/80 animate-pulse"
                  }
                  style={
                    basketStep && basketStep.total > 0
                      ? { width: `${Math.min(100, Math.max(8, Math.round((basketStep.step / basketStep.total) * 100)))}%` }
                      : undefined
                  }
                />
              </div>
              {basketStep && basketStep.total > 1 && basketStep.total <= 12 && (
                <div className="flex items-center gap-1" aria-hidden="true">
                  {Array.from({ length: basketStep.total }, (_, idx) => {
                    const n = idx + 1;
                    return (
                      <span
                        key={n}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          n < basketStep.step
                            ? "bg-emerald-400"
                            : n === basketStep.step
                            ? "bg-cyan-300 animate-pulse"
                            : "bg-slate-800"
                        }`}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {basketError && <div className="text-rose-200">{basketError}</div>}
          {basketResult && basketResult.failed?.length > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-100">
              Not completed: {basketResult.failed.map((f) => `${f.label} (${f.error})`).join(" · ")}. The other steps went through.
            </div>
          )}
          {basketResult && (
            <div className="text-emerald-100 space-y-1">
              <div>
                Received onchain:{" "}
                          {basketResult.received.length > 0
                            ? basketResult.received
                                .map((r) => `${r.tokens.toFixed(6)} ${r.symbol}${r.quotedTokens ? ` (quoted ${r.quotedTokens.toFixed(6)})` : ""}`)
                                .join(", ")
                            : "reading receipts…"}
              </div>
              {(basketResult.txs.length ? basketResult.txs : basketResult.txHashes.map((h) => ({ hash: h, status: "unknown" as const }))).map((t) => (
                <a
                  key={t.hash}
                  href={`https://basescan.org/tx/${t.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block font-mono underline hover:text-white"
                >
                  {t.status === "confirmed" ? "✓" : t.status === "failed" ? "✕" : "…"} {t.hash.slice(0, 14)}… on BaseScan
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer: participation statement + disclaimers (no third-party marks: Stocks Maxxing rules 6.7 / 11) */}
      <footer className="border-t border-slate-800/80 bg-[#070b14] px-4 pt-6 pb-28 md:pb-6 mt-12">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[11px] text-slate-500">
          <div className="max-w-3xl space-y-1.5">
            <div className="flex items-center gap-2.5 text-slate-300 font-medium">
              <MaxxAgentMark size={20} />
              <span>
                MAXXAGENT — an independent project built for the Base Builder Quest: Stocks Maxxing
                Season (Nov 5 – Dec 12, 2026).
              </span>
            </div>
            <p>
              Not affiliated with, endorsed or sponsored by Coinbase, Base, Chainlink, KyberSwap, any Stocks Maxxing
              partner, or any public company whose stock is referenced. Names are used only to identify the assets and
              data sources. Tokenized stocks are not the shares themselves and give no voting or shareholder rights
              beyond what the token provides. Information only, not financial, investment, legal or tax advice. Coinbase
              tokenized stocks are available only to eligible persons outside the United States.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0 text-slate-400">
            <a
              href="https://www.base.org/stocksmaxxing"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white underline"
            >
              Stocks Maxxing
            </a>
            <a href="/terms" className="hover:text-white underline">
              Terms &amp; Risks
            </a>
            <a href="/stats" className="hover:text-white underline">
              Live stats
            </a>
            <a href="/verify" className="hover:text-white underline">
              How to verify
            </a>
            <a href="/faq" className="hover:text-white underline">
              FAQ
            </a>
            <a href="/bankr" className="hover:text-white underline">
              Bankr skill
            </a>
            <a href="/status" className="hover:text-white underline">
              Status
            </a>
            <a
              href="https://github.com/0xAxelowETH/maxxagent"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white underline"
            >
              Source code (GitHub)
            </a>
            <a
              href="https://www.base.org/stocksmaxxing/rules"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white underline"
            >
              Competition rules
            </a>
            <a
              href="https://docs.base.org/sdks/tokenized-stocks/overview"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white underline"
            >
              B20 Docs
            </a>
          </div>
        </div>
      </footer>

      {/* Mobile bottom navigation */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-[#050a18]/95 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
        aria-label="Mobile sections"
      >
        <div className="grid grid-cols-6">
          {(
            [
              { id: "terminal", label: "Market", icon: TrendingUp },
              { id: "agent", label: "Agent", icon: Bot },
              { id: "indexes", label: "Indexes", icon: Layers },
              { id: "news", label: "News", icon: Newspaper },
              { id: "paired", label: "Paired", icon: Coins },
              { id: "traction", label: "Portfolio", icon: Wallet },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 text-[11px] font-semibold cursor-pointer ${
                  active ? "text-white" : "text-slate-400"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={`rounded-xl px-2.5 py-1 ${active ? "bg-[#4C6FFF]/25" : ""}`}>
                  <Icon className={`h-5 w-5 ${active ? "text-blue-300" : ""}`} />
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      <TermsGate open={termsAccepted === false} onAccept={() => setTermsAccepted(true)} />
    </div>
  );
}
