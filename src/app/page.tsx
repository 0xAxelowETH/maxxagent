"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Flame,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Terminal,
  TrendingUp,
  Wallet,
  Zap,
  Check,
  ChevronDown,
  LogOut,
} from "lucide-react";
import {
  B20DividendSplitSimulator,
  BasketSnapshotCard,
  GuidedQuickStartBar,
  InteractiveB20TradingChart,
  OnchainActivityEntry,
  OnchainActivityLogPanel,
  PlainEnglishGlossaryStrip,
} from "@/components/StockMaxxUxWidgets";
import {
  BASE_TOKENIZED_STOCKS,
  LiveTokenizedStock,
  PROGRAMMABLE_INDEX_PRESETS,
  ProgrammableIndexPreset,
  STOCKS_MAXXING_PARTNERS,
} from "@/lib/tokenizedStocks";
import {
  parseErc8021Calldata,
  toErc8021DataSuffix,
} from "@/lib/builderCode";
import { AgentAnalysisReport } from "@/lib/agentEngine";
import { INDEX_REGISTRY_ABI } from "@/lib/contracts/StockMaxxIndexRegistryABI";
import { decodeErrorResult, encodeFunctionData } from "viem";
import {
  prepareBuy,
  prepareSell,
  sendContractCall,
  submitOrder,
  QUOTE_TTL_MS,
  BasketLeg,
  BasketResult,
  PreparedOrder,
  SellLeg,
} from "@/lib/basketExecutor";
import { MaxxAgentLogo, MaxxAgentMark } from "@/components/BrandLogo";
import { OrderReview } from "@/components/OrderReview";
import { TradeHistoryPanel, type TradeHistoryEntry } from "@/components/TradeHistoryPanel";
import { MarketStatus } from "@/components/MarketStatus";
import { detectMiniApp } from "@/lib/miniApp";
import { RebalancePanel } from "@/components/RebalancePanel";
import { TermsGate, TERMS_STORAGE_KEY } from "@/components/TermsGate";
import {
  connectExternalWallet,
  disconnectExternalWallets,
  restoreExternalWallet,
  walletConnectConfigured,
  ExternalWalletKind,
} from "@/lib/walletConnectors";

type ActiveTab = "terminal" | "agent" | "indexes" | "traction" | "public";

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

const STOCK_LOGO_MAP: Record<string, string> = Object.fromEntries(
  BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s.logoUrl])
);

const STOCK_COLOR_MAP: Record<string, string> = Object.fromEntries(
  BASE_TOKENIZED_STOCKS.map((s) => [s.symbol, s.color])
);

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

/**
 * Interactive SVG Ring / Donut Chart for B20 Portfolio & Index Allocations
 */
function PortfolioDonutChart({
  items,
  centerLabel,
  centerValue,
}: {
  items: { symbol: string; weightBps: number; color: string; logoUrl?: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const totalBps = Math.max(
    1,
    items.reduce((acc, i) => acc + i.weightBps, 0)
  );
  let cumulativeFraction = 0;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-5">
      <div className="relative h-40 w-40 shrink-0 flex items-center justify-center">
        <svg viewBox="0 0 160 160" className="h-40 w-40 -rotate-90">
          <circle
            cx="80"
            cy="80"
            r={radius}
            fill="transparent"
            stroke="#1e293b"
            strokeWidth="16"
          />
          {items.map((item) => {
            const frac = item.weightBps / totalBps;
            const dash = Math.max(0, frac * circumference - 2.5);
            const offset = -cumulativeFraction * circumference;
            cumulativeFraction += frac;
            return (
              <circle
                key={item.symbol}
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke={item.color}
                strokeWidth="16"
                strokeDasharray={`${dash} ${circumference}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
            {centerLabel}
          </span>
          <span className="font-mono text-sm font-extrabold text-white mt-0.5">
            {centerValue}
          </span>
        </div>
      </div>

      {/* auto-fill keeps each legend item at least 150px wide so tickers never truncate */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 flex-1 w-full min-w-0">
        {items.map((item) => (
          <div
            key={item.symbol}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-[#050914]/90 px-2.5 py-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              {item.logoUrl && (
                <img
                  src={item.logoUrl}
                  alt={item.symbol}
                  className="h-4 w-4 rounded-full object-cover shrink-0"
                />
              )}
              <span className="font-mono text-xs font-bold text-white truncate">
                {item.symbol}
              </span>
            </div>
            <span className="font-mono text-xs font-semibold text-cyan-300 shrink-0">
              {(item.weightBps / 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Oracle age for compact cells: 12m / 17h / 2d
const fmtAge = (m: number) => (m < 60 ? `${Math.round(m)}m ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`);

const SLIPPAGE_OPTIONS = [30, 50, 100];

// ---- Shareable basket links: /?basket=NVDAc-40,MSFTc-30&amount=50 --------------------------------
const PUBLIC_SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const SHARE_SYMBOLS = new Set(BASE_TOKENIZED_STOCKS.map((s) => s.symbol));

/** weights in bps (10,000 = 100%) -> query string */
function basketToQuery(weightsBps: Record<string, number>, amountUsd?: number): string {
  const parts = Object.entries(weightsBps)
    .filter(([, w]) => w > 0)
    .map(([sym, w]) => `${sym}-${Number((w / 100).toFixed(2))}`);
  const q = new URLSearchParams({ basket: parts.join(",") });
  if (amountUsd && amountUsd >= 1) q.set("amount", String(amountUsd));
  return q.toString();
}

/** Parses and validates a shared basket. Unknown symbols are dropped; weights are normalized to 100%. */
function parseSharedBasket(search: string): { weightsBps: Record<string, number>; amountUsd?: number } | null {
  const q = new URLSearchParams(search);
  const raw = q.get("basket");
  if (!raw) return null;
  const pct = new Map<string, number>();
  for (const part of raw.split(",").slice(0, 10)) {
    const [sym, val] = part.split("-");
    const n = Number(val);
    if (SHARE_SYMBOLS.has(sym) && Number.isFinite(n) && n > 0 && n <= 100 && !pct.has(sym)) pct.set(sym, n);
  }
  if (pct.size === 0) return null;
  const total = [...pct.values()].reduce((a, b) => a + b, 0);
  const weightsBps: Record<string, number> = {};
  for (const [sym, n] of pct) weightsBps[sym] = Math.round((n / total) * 10000);
  // rounding remainder goes to the largest weight so the basket is exactly 100%
  const diff = 10000 - Object.values(weightsBps).reduce((a, b) => a + b, 0);
  const largest = Object.entries(weightsBps).sort((a, b) => b[1] - a[1])[0][0];
  weightsBps[largest] += diff;
  const amount = Number(q.get("amount"));
  return { weightsBps, amountUsd: Number.isFinite(amount) && amount >= 1 && amount <= 10000 ? Math.round(amount * 100) / 100 : undefined };
}

export default function StockMaxxingDashboard() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("terminal");

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
  // Connected-wallet dropdown (copy address, BaseScan, switch, disconnect)
  const [accountMenuOpen, setAccountMenuOpen] = useState<boolean>(false);
  const [addressCopied, setAddressCopied] = useState<boolean>(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!accountMenuRef.current?.contains(e.target as Node)) setAccountMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAccountMenuOpen(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [accountMenuOpen]);
  const [connectedWalletName, setConnectedWalletName] = useState<string>("");
  const [connectingWallet, setConnectingWallet] = useState<boolean>(false);
  const providerRef = useRef<EthereumProvider | null>(null);
  const detachListenersRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      setWalletProviders((prev) => (prev.some((p) => p.info.uuid === detail.info.uuid) ? prev : [...prev, detail]));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);
  const getEthProvider = useCallback((): EthereumProvider | null => {
    return providerRef.current ?? (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
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
  const [, setInspectAddress] = useState<string>("");
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
  // Tokenized stocks exist on Base Mainnet only
  const txTargetNetwork = "mainnet" as "sepolia" | "mainnet";

  // UX Ease-of-Use State: Virtual Demo Sandbox, Simple/Pro Mode, & Table Search/Filters
  const [proMode, setProMode] = useState<boolean>(false);
  const [chartSelectedSymbol, setChartSelectedSymbol] = useState<string>("NVDAc");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>("ALL");
  const [selectedSignalFilter, setSelectedSignalFilter] = useState<string>("ALL");

  // AI Agent State
  const [userPrompt, setUserPrompt] = useState<string>(
    "AI and cloud compute leaders (NVDAc, MSFTc, GOOGLc, SNDKc), prefer stocks trading below NAV"
  );
  const [riskProfile, setRiskProfile] = useState<"Conservative" | "Balanced" | "Aggressive">(
    "Balanced"
  );
  const [capitalUsd, setCapitalUsd] = useState<number>(20);
  // Single-stock trade amount (Swap panel), separate from the basket capital in the Agent tab
  const [tradeUsd, setTradeUsd] = useState<number>(10);
  const [agentReport, setAgentReport] = useState<AgentAnalysisReport | null>(null);
  const [runningAgent, setRunningAgent] = useState<boolean>(false);

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
        <input
          type="number"
          min={1}
          max={10000}
          step={1}
          value={basketUsd || ""}
          onChange={(e) => setBasketUsd(Math.max(0, Number(e.target.value) || 0))}
          className="w-24 rounded-lg border border-slate-700 bg-[#050811] py-1.5 pl-6 pr-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
          aria-label="Basket amount in USD"
        />
      </span>
      {payToggle}
    </span>
  );
  const [basketPending, setBasketPending] = useState<boolean>(false);
  const [basketStatus, setBasketStatus] = useState<string>("");
  const [basketError, setBasketError] = useState<string>("");
  const [basketResult, setBasketResult] = useState<BasketResult | null>(null);

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

  const recordResult = useCallback(
    (result: BasketResult, label: string) => {
      setBasketResult(result);
      setTimeout(() => setBalanceRefreshNonce((n) => n + 1), 6000);
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
    [recordOnchainActivity]
  );

  // Step 1 (buy): quote one or more B20 stocks and open the review. Nothing is sent yet.
  const buyStocks = useCallback(
    async (legs: BasketLeg[], label: string) => {
      setBasketError("");
      setBasketResult(null);
      if (!nonUsComplianceAccepted) {
        setBasketError("Please accept the terms first (reload the page to see them).");
        return;
      }
      const validLegs = legs.filter((l) => l.usd >= 1);
      if (validLegs.length < legs.length) {
        // Never silently drop part of a basket: tell the user the smallest total that funds every stock
        const total = legs.reduce((a, l) => a + l.usd, 0);
        const smallest = Math.min(...legs.map((l) => l.usd));
        const needed = smallest > 0 ? Math.ceil(total / smallest) : 0;
        setBasketError(`Each stock needs at least $1.${needed > 0 ? ` For this basket, use at least $${needed}.` : ""}`);
        return;
      }
      const eth = getEthProvider();
      if (!eth) {
        setBasketError("No wallet detected. Install Coinbase Wallet or MetaMask to buy on Base.");
        return;
      }
      setBasketPending(true);
      try {
        const sender = await resolveSender(eth);
        if (sender.toLowerCase() !== walletAddress.toLowerCase()) setWalletAddress(sender);
        const order = await prepareBuy({ eth, sender, legs: validLegs, slippageBps: slippageRef.current, onStatus: setBasketStatus });
        setReview({ order, label, legs: { buy: validLegs } });
      } catch (err: unknown) {
        setBasketError(err instanceof Error ? err.message : "Could not prepare the order");
      } finally {
        setBasketStatus("");
        setBasketPending(false);
      }
    },
    [nonUsComplianceAccepted, walletAddress, getEthProvider, resolveSender]
  );

  // Step 1 (sell): quote the sale and open the review. Nothing is sent yet.
  const sellStocks = useCallback(
    async (legs: SellLeg[], label: string) => {
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
      setBasketPending(true);
      try {
        const sender = await resolveSender(eth);
        if (sender.toLowerCase() !== walletAddress.toLowerCase()) {
          // The sell amounts came from the balances of the previously shown account: refresh, don't sell
          setWalletAddress(sender);
          setBalanceRefreshNonce((n) => n + 1);
          throw new Error("Your wallet switched to another account. Balances were refreshed: check them and try again.");
        }
        const order = await prepareSell({ eth, sender, legs: validLegs, slippageBps: slippageRef.current, onStatus: setBasketStatus });
        setReview({ order, label, legs: { sell: validLegs } });
      } catch (err: unknown) {
        setBasketError(err instanceof Error ? err.message : "Could not prepare the sale");
      } finally {
        setBasketStatus("");
        setBasketPending(false);
      }
    },
    [nonUsComplianceAccepted, walletAddress, getEthProvider, resolveSender]
  );

  // Re-quote the order under review (expired quote or user request)
  const refreshReview = useCallback(async (newSlippageBps?: number) => {
    if (!review) return;
    if (newSlippageBps) {
      slippageRef.current = newSlippageBps;
      setSlippageBps(newSlippageBps);
      try {
        localStorage.setItem("maxxagent_slippage_bps", String(newSlippageBps));
      } catch {}
    }
    const eth = getEthProvider();
    if (!eth) return;
    setReviewBusy(true);
    setBasketError("");
    try {
      const { sender } = review.order;
      const order = review.legs.buy
        ? await prepareBuy({ eth, sender, legs: review.legs.buy, slippageBps: slippageRef.current, onStatus: setBasketStatus })
        : await prepareSell({ eth, sender, legs: review.legs.sell || [], slippageBps: slippageRef.current, onStatus: setBasketStatus });
      setReview({ ...review, order });
    } catch (err: unknown) {
      setReview(null);
      setBasketError(err instanceof Error ? err.message : "Could not refresh the quote");
    } finally {
      setBasketStatus("");
      setReviewBusy(false);
    }
  }, [review, getEthProvider]);

  // Step 2: the user confirmed the review; only now does the wallet open
  const confirmReview = useCallback(async () => {
    if (!review) return;
    if (Date.now() - review.order.preparedAt > QUOTE_TTL_MS) {
      await refreshReview(); // show fresh numbers first, never send a stale quote silently
      return;
    }
    const eth = getEthProvider();
    if (!eth) return;
    const { order, label } = review;
    setReview(null);
    setBasketPending(true);
    try {
      const result = await submitOrder({ eth, order, builderCode, onStatus: setBasketStatus });
      recordResult(result, label);
    } catch (err: unknown) {
      setBasketError(
        err instanceof Error ? err.message : order.side === "buy" ? "Purchase cancelled or failed" : "Sale cancelled or failed"
      );
    } finally {
      setBasketStatus("");
      setBasketPending(false);
    }
  }, [review, refreshReview, getEthProvider, builderCode, recordResult]);

  // Build in Public State
  const [dayNumber, setDayNumber] = useState<number>(1);
  const [milestoneTitle, setMilestoneTitle] = useState<string>(
    "Shipped live Chainlink NAV vs DEX price tracking for all 10 Coinbase tokenized stocks on Base"
  );

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
  const fetchLiveStocks = useCallback(async (walletToQuery?: string) => {
    setLoadingStocks(true);
    try {
      const q = walletToQuery ? `?wallet=${encodeURIComponent(walletToQuery)}` : "";
      const res = await fetch(`/api/stocks${q}`);
      const data = await res.json();
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
        if (walletToQuery) setBalancesError(data.walletBalances ? "" : data.walletError || "Could not read your balances.");
        if (typeof data.walletUsdc === "number") setUsdcBalance(data.walletUsdc);
        if (typeof data.walletEth === "number") setEthBalance(data.walletEth);
        if (typeof data.ethUsd === "number") setEthUsd(data.ethUsd);
      }
    } catch (err) {
      if (walletToQuery) setBalancesError("Could not reach the server. Check your connection.");
      console.error("Failed to fetch live tokenized stocks:", err);
    } finally {
      setLoadingStocks(false);
    }
  }, []);

  // Run AI Stock Agent (analysis only; execution always happens from the user's own wallet)
  const triggerStockAgent = useCallback(
    async (stocksData?: LiveTokenizedStock[], promptOverride?: string) => {
      setRunningAgent(true);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stocks: stocksData || stocks,
            userPrompt: promptOverride ?? userPrompt,
            riskProfile,
            capitalUsd,
            builderCode,
          }),
        });
        const data = await res.json();
        if (data?.ok && data.report) {
          setAgentReport(data.report);
        }
      } catch (err) {
        console.error("Agent error:", err);
      } finally {
        setRunningAgent(false);
      }
    },
    [stocks, userPrompt, riskProfile, capitalUsd, builderCode]
  );

  useEffect(() => {
    fetchLiveStocks().then(() => {});
  }, [fetchLiveStocks]);

  useEffect(() => {
    if (balanceRefreshNonce > 0 && walletAddress) fetchLiveStocks(walletAddress);
  }, [balanceRefreshNonce, walletAddress, fetchLiveStocks]);

  useEffect(() => {
    if (!walletAddress || balancesFor !== walletAddress.toLowerCase()) return;
    let cancelled = false;
    const w = walletAddress.toLowerCase();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      fetch(`/api/pnl?wallet=${w}`)
        .then(async (r) => {
          const d = await r.json();
          if (cancelled) return;
          // 503 = server busy with other first-time scans: retry once instead of showing an error
          if (r.status === 503 && attempt === 0) retry = setTimeout(() => load(1), 5000);
          else setPnl({ for: w, data: d?.ok ? d : null, error: d?.ok ? "" : d?.error || "P/L unavailable" });
        })
        .catch(() => {
          if (!cancelled) setPnl({ for: w, data: null, error: "P/L unavailable right now." });
        });
    load(0);
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
    };
  }, [walletAddress, balancesFor, walletBalances]);

  useEffect(() => {
    if (stocks.length > 0 && !agentReport) {
      triggerStockAgent(stocks);
    }
  }, [stocks, agentReport, triggerStockAgent]);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(""), 2200);
  };


  // Remember the wallet the user picked, so a page refresh reconnects silently (no popup)
  const WALLET_STORAGE_KEY = "maxxagent_wallet";
  type SavedWallet = { kind: "injected"; rdns: string; name: string } | { kind: ExternalWalletKind };
  const saveWallet = (w: SavedWallet | null) => {
    try {
      if (w) localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(w));
      else localStorage.removeItem(WALLET_STORAGE_KEY);
    } catch {}
  };

  // Shared by manual connect and silent restore: show the account, read balances, listen for changes
  const attachWallet = (eth: EthereumProvider, account: string, chainId: string) => {
    setWalletAddress(account);
    setInspectAddress(account);
    setChainIdHex(chainId);
    fetchLiveStocks(account);
    // One set of listeners at a time: reconnecting must not stack duplicates
    detachListenersRef.current?.();
    const onAccounts = (...args: unknown[]) => {
      const next = (args[0] as string[] | undefined)?.[0] || "";
      setWalletAddress(next);
      setInspectAddress(next);
      setWalletBalances({});
      setUsdcBalance(null);
      if (next) fetchLiveStocks(next);
      else saveWallet(null); // disconnected from inside the wallet: don't auto-reconnect
    };
    const onChain = (...args: unknown[]) => setChainIdHex(String(args[0] || ""));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    detachListenersRef.current = () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  };

  const disconnectWallet = async () => {
    setAccountMenuOpen(false);
    detachListenersRef.current?.();
    detachListenersRef.current = null;
    try {
      localStorage.removeItem("maxxagent_wallet");
    } catch {}
    await disconnectExternalWallets();
    if (!inMiniApp) providerRef.current = null; // in a mini app the host wallet stays the provider
    setWalletAddress("");
    setInspectAddress("");
    setWalletBalances({});
    setUsdcBalance(null);
    setConnectedWalletName("");
  };

  // Connect EVM Wallet & switch to Base Mainnet (8453)
  const connectWallet = async (picked?: Eip6963ProviderDetail, external?: ExternalWalletKind) => {
    setTxError("");
    setShowWalletMenu(false);
    if (picked) {
      providerRef.current = picked.provider;
      setConnectedWalletName(picked.info.name);
    }
    if (external) {
      // Coinbase Smart Wallet (passkey popup) or WalletConnect (QR / mobile deep link)
      setConnectingWallet(true);
      try {
        providerRef.current = (await connectExternalWallet(external)) as EthereumProvider;
        setConnectedWalletName(external === "coinbase" ? "Coinbase Smart Wallet" : "WalletConnect");
      } catch (err: unknown) {
        setConnectingWallet(false);
        const msg = err instanceof Error ? err.message : "";
        setTxError(/reject|closed|cancel/i.test(msg) ? "Wallet connection cancelled." : "Could not connect the wallet. Please try again.");
        return;
      }
      setConnectingWallet(false);
    }
    const eth = getEthProvider();
    if (!eth) {
      setTxError(
        "No wallet found in this browser. Choose Coinbase Smart Wallet or WalletConnect from the Connect menu."
      );
      return;
    }
    try {
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainId = (await eth.request({ method: "eth_chainId" })) as string;
      if (accounts && accounts[0]) {
        attachWallet(eth, accounts[0], chainId);
        if (external) saveWallet({ kind: external });
        else if (picked) saveWallet({ kind: "injected", rdns: picked.info.rdns, name: picked.info.name });
      }
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Wallet connection rejected");
    }
  };

  // Opened as a mini app (Farcaster / Base App): use the host's wallet, already authorised by the user there
  const restoreTried = useRef(false);
  const [inMiniApp, setInMiniApp] = useState(false);
  useEffect(() => {
    let cancelled = false;
    detectMiniApp().then(async (found) => {
      if (!found || cancelled) return;
      restoreTried.current = true; // the host wallet replaces any saved browser wallet
      const eth = found.provider as EthereumProvider;
      providerRef.current = eth;
      setInMiniApp(true);
      setConnectedWalletName("Mini app wallet");
      try {
        const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
        const chainId = (await eth.request({ method: "eth_chainId" }).catch(() => "")) as string;
        if (!cancelled && accounts?.[0]) attachWallet(eth, accounts[0], chainId);
      } catch {
        // The user can still connect from the Connect button (it uses the host wallet)
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silent reconnect after a refresh. Never opens a popup: eth_accounts / stored SDK sessions only.
  useEffect(() => {
    if (restoreTried.current || walletAddress) return;
    let saved: SavedWallet | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY) || "null");
    } catch {}
    if (!saved) {
      restoreTried.current = true;
      return;
    }
    const finish = async (eth: EthereumProvider, name: string) => {
      const accounts = (await eth.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (!accounts?.[0]) return; // the wallet no longer authorizes this site: stay disconnected
      const chainId = (await eth.request({ method: "eth_chainId" }).catch(() => "")) as string;
      providerRef.current = eth;
      setConnectedWalletName(name);
      attachWallet(eth, accounts[0], chainId);
    };
    if (saved.kind === "injected") {
      // Wait for the extension to announce itself (EIP-6963); give up quietly if it never does
      const match = walletProviders.find((p) => p.info.rdns === (saved as { rdns: string }).rdns);
      if (!match) return; // re-runs when walletProviders updates
      restoreTried.current = true;
      finish(match.provider as EthereumProvider, match.info.name);
    } else {
      restoreTried.current = true;
      const kind = saved.kind;
      restoreExternalWallet(kind).then((p) => {
        if (p) finish(p as EthereumProvider, kind === "coinbase" ? "Coinbase Smart Wallet" : "WalletConnect");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletProviders, walletAddress]);

  const switchToBaseMainnet = async (modeOverride?: "sepolia" | "mainnet") => {
    const mode = modeOverride || txTargetNetwork;
    const targetChainHex = mode === "sepolia" ? "0x14a34" : "0x2105";
    const eth = getEthProvider();
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainHex }],
      });
      setChainIdHex(targetChainHex);
    } catch {
      try {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            mode === "sepolia"
              ? {
                  chainId: "0x14a34",
                  chainName: "Base Sepolia Testnet",
                  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://sepolia.base.org"],
                  blockExplorerUrls: ["https://sepolia.basescan.org"],
                }
              : {
                  chainId: "0x2105",
                  chainName: "Base Mainnet",
                  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["https://mainnet.base.org"],
                  blockExplorerUrls: ["https://basescan.org"],
                },
          ],
        });
        setChainIdHex(targetChainHex);
      } catch (e: unknown) {
        setTxError(e instanceof Error ? e.message : "Failed to switch to Base network");
      }
    }
  };

  // Publish an index to StockMaxxIndexRegistry (non-custodial: stores names & weights only)
  const publishIndexOnchain = async (
    name: string,
    ticker: string,
    entries: { b20Address: string; weightBps: number }[]
  ) => {
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
    const eth = getEthProvider();
    if (!eth) {
      setTxError("No wallet detected. Install Coinbase Wallet or MetaMask to publish on Base.");
      return;
    }
    setTxPending(true);
    setPublishStatus("Checking…");
    try {
      // The account that will actually sign (never a stale one from before an account switch)
      const sender = walletAddress ? await resolveSender(eth) : ((await eth.request({ method: "eth_requestAccounts" })) as string[])[0];
      if (sender.toLowerCase() !== walletAddress.toLowerCase()) setWalletAddress(sender);
      // The dry run must hit Base (on another chain the registry address has no code and would "pass")
      const currentChain = (await eth.request({ method: "eth_chainId" })) as string;
      if (currentChain?.toLowerCase() !== "0x2105") await switchToBaseMainnet("mainnet");
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
        await eth.request({ method: "eth_call", params: [{ from: sender, to: registryAddress, data: calldata }, "latest"] });
      } catch (simErr) {
        const e = simErr as { data?: unknown; message?: string };
        const raw = (typeof e?.data === "string" ? e.data : (e?.data as { data?: string })?.data) || "";
        let reason = "";
        try {
          if (/^0x[0-9a-fA-F]{8}/.test(raw)) reason = decodeErrorResult({ abi: INDEX_REGISTRY_ABI, data: raw as `0x${string}` }).errorName;
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
        throw new Error(`The registry would reject this index${reason ? `: ${nice[reason] || reason}` : ""}. Nothing was sent.`);
      }
      const hash = await sendContractCall({ eth, sender, to: registryAddress, data: calldata, builderCode, onStatus: setPublishStatus });
      setTxHash(hash);
      recordOnchainActivity(`PUBLISH_INDEX ${cleanTicker}`, hash, "Base Mainnet (8453)");
      loadPublishedIndexes();
    } catch (err: unknown) {
      setTxError(err instanceof Error ? err.message : "Transaction cancelled or failed");
    } finally {
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

  const normalizeCustomWeights = () => {
    const entries = Object.entries(customWeights).filter(([, w]) => w > 0);
    const sum = entries.reduce((acc, [, w]) => acc + w, 0);
    if (sum === 0) return;
    const next: Record<string, number> = {};
    let running = 0;
    entries.forEach(([sym, w], idx) => {
      if (idx === entries.length - 1) {
        next[sym] = 10000 - running;
      } else {
        const norm = Math.round((w / sum) * 10000);
        next[sym] = norm;
        running += norm;
      }
    });
    setCustomWeights(next);
  };

  const totalCustomWeightBps = Object.values(customWeights).reduce((a, b) => a + b, 0);

  // Opened from a shared link: load the basket into the index builder (the user still reviews and confirms)
  const [sharedBasketLoaded, setSharedBasketLoaded] = useState<boolean>(false);
  useEffect(() => {
    // /?stock=NVDAc (from a stock detail page): select it and jump to the Swap panel
    const wanted = new URLSearchParams(window.location.search).get("stock");
    const match = BASE_TOKENIZED_STOCKS.find((s) => s.symbol.toLowerCase() === (wanted || "").toLowerCase());
    if (match) {
      setChartSelectedSymbol(match.symbol);
      setActiveTab("terminal");
      setTimeout(() => document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 600);
    }
    const shared = parseSharedBasket(window.location.search);
    if (!shared) return;
    setCustomWeights(shared.weightsBps);
    const q = new URLSearchParams(window.location.search);
    const pay = q.get("pay");
    if (pay === "eth" || pay === "usdc") setBasketPayWith(pay);
    const sharedName = (q.get("name") || "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 64);
    setCustomIndexName(sharedName || "Shared basket");
    if (shared.amountUsd) setBasketUsd(shared.amountUsd);
    setActiveTab("indexes");
    setSharedBasketLoaded(true);
    setTimeout(() => document.getElementById("index-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const shareLinkFor = (weightsBps: Record<string, number>) =>
    `${typeof window !== "undefined" ? window.location.origin : PUBLIC_SITE_URL}/?${basketToQuery(weightsBps, basketUsd)}`;
  const attributionInfo = toErc8021DataSuffix([builderCode]);
  const sampleDecoded = parseErc8021Calldata(
    agentReport?.onchainExecution.attributedCalldata || attributionInfo.dataSuffix
  );

  // Filter & Search B20 Equities for Tab 1 Table
  const filteredStocks = stocks.filter((st) => {
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
  });

  // Compute Build-in-Public X Post with live Base Mainnet telemetry
  // No made-up fallbacks: 0 until live data has loaded
  const nvdaPrice = stocks.find((s) => s.symbol === "NVDAc")?.navPrice ?? 0;
  const tslaPrice = stocks.find((s) => s.symbol === "TSLAc")?.navPrice ?? 0;
  const spcxPrice = stocks.find((s) => s.symbol === "SPCXc")?.navPrice ?? 0;
  const nvdaMult = stocks.find((s) => s.symbol === "NVDAc")?.uiMultiplier ?? 1;

  const buildInPublicPost = `Day ${dayNumber} building MAXXAGENT for #StocksMaxxing on @base 🔵

✅ ${milestoneTitle}

Live from Base right now:
• $NVDAc NAV $${nvdaPrice.toFixed(2)} (multiplier ${nvdaMult.toFixed(6)}x)
• $TSLAc NAV $${tslaPrice.toFixed(2)}
• $SPCXc NAV $${spcxPrice.toFixed(2)}
• Tokenized stock TVL tracked: $${(totalTvlUsd / 1e6).toFixed(2)}M

Agent-picked baskets of tokenized stocks, bought from your own wallet. Not financial advice.
@buildonbase`;

  return (
    <div className="min-h-screen flex flex-col bg-[#03060e] text-slate-100 relative overflow-x-hidden bg-cyber-grid">
      {/* Ambient Base Blue & Cyan Aurora Lighting */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-44 left-1/4 h-[460px] w-[680px] rounded-full bg-[#4C6FFF]/15 blur-[140px]" />
        <div className="absolute top-64 right-1/6 h-[380px] w-[520px] rounded-full bg-cyan-500/10 blur-[130px]" />
        <div className="absolute bottom-0 left-1/3 h-[340px] w-[580px] rounded-full bg-emerald-500/8 blur-[140px]" />
      </div>

      {/* Compact context bar */}
      <div className="relative z-30 border-b border-slate-800/80 bg-[#040814]/95 px-4 py-1.5 text-[11px] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            Built for Base Stocks Maxxing Season · independent project
          </span>
          <MarketStatus />
          <span className="hidden sm:inline">Not financial advice · eligible non-US persons only</span>
        </div>
      </div>

      {/* Live Infinite Wall Street x Base B20 Stock Ticker Tape */}
      <div className="relative z-30 border-b border-slate-800/80 bg-[#050a18]/90 py-2 overflow-hidden">
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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <MaxxAgentLogo size={40} tagline="Tokenized stock indexes on Base" />
            <span className="hidden 2xl:inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 border border-emerald-500/30">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              LIVE · BASE MAINNET
            </span>
          </div>

          {/* Global KPIs & Wallet Connect */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
            <div className="hidden xl:flex items-center gap-5 rounded-2xl border border-slate-800/90 bg-[#091022]/90 px-4 py-2 shadow-inner">
              <div className="flex items-center gap-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
                    Base B20 Stock TVL
                  </div>
                  <div className="font-mono text-sm font-bold text-white">
                    ${(totalTvlUsd / 1e6).toFixed(2)}M{" "}
                    <span className="text-[10px] font-semibold text-emerald-400">Live</span>
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
                    ${(totalDexVolume24hUsd / 1e6).toFixed(2)}M{" "}
                    <span className="text-[10px] font-normal text-slate-400">
                      (${(totalDexLiquidityUsd / 1e6).toFixed(2)}M Liq)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {walletAddress ? (
              <div className="flex items-center gap-2">
                {chainIdHex && chainIdHex !== "0x2105" && (
                  <button
                    onClick={() => switchToBaseMainnet("mainnet")}
                    className="rounded-xl bg-amber-500/20 border border-amber-500/40 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/30 transition cursor-pointer"
                    title="Tokenized stocks are on Base Mainnet"
                  >
                    Wrong network — switch to Base
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
              <div className="relative">
                <button
                  // Inside a mini app the host wallet is the only option: connect to it directly
                  onClick={() => (inMiniApp ? connectWallet() : setShowWalletMenu((v) => !v))}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-[#2563eb] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/35 hover:brightness-110 transition cursor-pointer border border-blue-400/30"
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
                        className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-slate-800 cursor-pointer"
                      >
                        {p.info.icon ? <img src={p.info.icon} alt="" className="h-5 w-5 rounded" /> : <Wallet className="h-4 w-4" />}
                        {p.info.name}
                      </button>
                    ))}
                    {walletProviders.length > 0 && (
                      <div className="px-2 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        No extension? Use one of these
                      </div>
                    )}
                    <button
                      onClick={() => connectWallet(undefined, "coinbase")}
                      className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-800 cursor-pointer"
                    >
                      <img src="/logos/brands/coinbase-wordmark.svg" alt="" className="mt-1 h-3 w-auto" />
                      <span>
                        <span className="block text-xs font-semibold text-slate-200">Coinbase Smart Wallet</span>
                        <span className="block text-[10px] text-slate-500">Passkey wallet in a popup — works on phones</span>
                      </span>
                    </button>
                    {walletConnectConfigured() && (
                      <button
                        onClick={() => connectWallet(undefined, "walletconnect")}
                        className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left hover:bg-slate-800 cursor-pointer"
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
        <nav className="mx-auto max-w-7xl px-4 hidden md:block" aria-label="Sections">
          <div className="flex overflow-x-auto gap-1.5 border-t border-slate-800/60 pt-2.5 pb-2.5">
            {[
              {
                id: "terminal",
                label: "Market",
                icon: TrendingUp,
                badge: "10 stocks",
              },
              {
                id: "agent",
                label: "Agent",
                icon: Bot,
                badge: "Agentic",
              },
              {
                id: "indexes",
                label: "Indexes",
                icon: Layers,
                badge: "Onchain",
              },
              {
                id: "traction",
                label: "Portfolio",
                icon: Zap,
                badge: "Yours",
              },
              {
                id: "public",
                label: "Studio",
                icon: Flame,
                badge: "Team",
              },
            ]
              .filter((tab) => tab.id !== "public" || studioMode)
              .map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as ActiveTab)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    isActive
                      ? "bg-gradient-to-r from-[#4C6FFF] to-[#1d4ed8] text-white shadow-lg shadow-[#4C6FFF]/30 border border-blue-400/30"
                      : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 border border-transparent"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
                      isActive ? "bg-white/20 text-white" : "bg-slate-800/90 text-slate-400"
                    }`}
                  >
                    {tab.badge}
                  </span>
                </button>
              );
            })}
            <span className="ml-auto flex items-center gap-1">
              <a href="/stats" className="whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                Live stats
              </a>
              <a href="/faq" className="whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-400 hover:bg-slate-800/60 hover:text-slate-200">
                FAQ
              </a>
            </span>
          </div>
        </nav>
        {/* Phones: the bottom bar holds the 4 tabs, so the help links sit under the header */}
        <div className="md:hidden mx-auto flex max-w-7xl justify-end gap-4 px-4 pb-2 text-[11px] font-semibold text-slate-400">
          <a href="/stats" className="hover:text-white">Live stats</a>
          <a href="/faq" className="hover:text-white">FAQ</a>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 px-3 sm:px-4 pt-4 sm:pt-6 pb-28 md:pb-10 space-y-5 sm:space-y-6">
        {/* 3-step quick start (Market tab, until a wallet is connected) */}
        {activeTab === "terminal" && !walletAddress && (
          <GuidedQuickStartBar
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            proMode={proMode}
            onToggleProMode={() => setProMode((p) => !p)}
            onQuickRunAgent={() => triggerStockAgent()}
            onQuickBuy={() => setActiveTab("agent")}
          />
        )}

        {/* Eligibility attestation & index registry status */}
        <div className="glass-panel rounded-2xl px-4 py-3 hidden md:flex flex-row flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200">
              <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
              Terms accepted
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-emerald-300/80 underline">
                review
              </a>
            </span>

            <span className="hidden sm:inline text-[11px] text-slate-400">
              Base Mainnet only · non-custodial · you sign every transaction
            </span>
          </div>

          {hasRegistry && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400 font-semibold">Index registry:</span>
            {hasRegistry ? (
              <a
                href={`https://basescan.org/address/${registryAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 font-mono text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/25 transition"
              >
                {registryAddress.slice(0, 8)}…{registryAddress.slice(-6)}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                not deployed yet
              </span>
            )}
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
                      Onchain Transaction Broadcasted on{" "}
                      {txTargetNetwork === "sepolia" ? "Base Sepolia Testnet" : "Base Mainnet"}{" "}
                      with ERC-8021 Builder Code [{builderCode}]!
                    </p>
                    <a
                      href={`https://${
                        txTargetNetwork === "sepolia" ? "sepolia." : ""
                      }basescan.org/tx/${txHash}`}
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

        {/* =====================================================================
            TAB 1: LIVE B20 EQUITIES & CHAINLINK TOTAL-RETURN ORACLE TERMINAL
           ===================================================================== */}
        {activeTab === "terminal" && (
          <div className="space-y-6">
            {/* Institutional Hero Command Center + 4-Card Bento KPI Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 glass-panel rounded-3xl p-6 sm:p-7 relative overflow-hidden flex flex-col justify-between">
                <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#4C6FFF]/20 blur-3xl" />
                <div className="space-y-4 relative z-10">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-2 rounded-full bg-[#4C6FFF]/20 border border-[#4C6FFF]/45 px-3 py-1 text-xs font-semibold text-blue-200">
                      <Layers className="h-3.5 w-3.5" />
                      <span>Programmable stock indexes on Base</span>
                    </span>
                  </div>

                  <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight">
                    Build your own stock index.{" "}
                    <span className="bg-gradient-to-r from-[#60a5fa] via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                      Buy it in one click, from your wallet.
                    </span>
                  </h2>

                  <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">
                    Mix NVIDIA, Apple, Tesla and 7 more Coinbase tokenized stocks into a custom index, or let the
                    agent propose one from live NAV, DEX prices and liquidity. Buy the whole basket with USDC or ETH
                    in one confirmation, share it as a link, and rebalance it later. Stocks go straight to your wallet.
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-4 relative z-10">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2 overflow-hidden">
                      {BASE_TOKENIZED_STOCKS.map((st) => (
                        <img
                          key={st.symbol}
                          src={st.logoUrl}
                          alt={st.companyName}
                          title={`${st.companyName} (${st.symbol})`}
                          className="inline-block h-7 w-7 rounded-full ring-2 ring-[#070d1d] bg-slate-900 object-cover"
                        />
                      ))}
                    </div>
                    <span className="text-xs text-slate-400 font-medium pl-1">
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
                        setTimeout(() => document.getElementById("index-builder")?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
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
                      USDC or ETH → stocks in one confirmation. Cost quoted live; routes over 1.5% refused.
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                    Stocks go straight to your wallet
                  </div>
                </div>
              </div>
            </div>

            {/* Spotlight B20 Equity Bento Cards with Live SVG Sparklines (phones: the chart's stock picker covers this) */}
            <div className="hidden sm:grid grid-cols-2 lg:grid-cols-4 gap-4">
              {(stocks.length > 0 ? stocks.slice(0, 4) : []).map((stock) => {
                const isPos = stock.change24hPct >= 0;
                const isChartActive = chartSelectedSymbol === stock.symbol;
                return (
                  <div
                    key={stock.symbol}
                    onClick={() => setChartSelectedSymbol(stock.symbol)}
                    className={`glass-panel glass-panel-hover rounded-2xl p-4 relative overflow-hidden flex flex-col justify-between cursor-pointer ${
                      isChartActive ? "ring-2 ring-[#4C6FFF]/80" : ""
                    }`}
                  >
                    <div
                      className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl"
                      style={{ backgroundColor: stock.color }}
                    />
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
                            <span className="font-mono text-sm font-extrabold text-white">
                              {stock.symbol}
                            </span>
                            {stock.uiMultiplier > 1.00001 && (
                              <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
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
                        className={`rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold ${
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
                        <div className="font-mono text-lg font-extrabold text-white">
                          ${stock.navPrice.toFixed(2)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-semibold">
                          DEX price 24/7
                        </div>
                        <div className="font-mono text-xs font-bold text-cyan-300">
                          ${stock.dexPrice24_7.toFixed(2)}{" "}
                          <span className="text-[10px] text-slate-400">
                            ({stock.weekendGapPct >= 0 ? "+" : ""}
                            {stock.weekendGapPct.toFixed(2)}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-800/70 flex items-center justify-between gap-2">
                      <button
                        onClick={() => {
                          // Open this stock in the Swap panel to choose the amount
                          setChartSelectedSymbol(stock.symbol);
                          document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#4C6FFF]/20 hover:bg-[#4C6FFF]/35 border border-[#4C6FFF]/45 px-2.5 py-1.5 text-[11px] font-bold text-blue-200 transition cursor-pointer"
                        title={`Buy or sell ${stock.symbol}: choose any amount in the Swap panel`}
                      >
                        <Zap className="h-3 w-3" />
                        Trade {stock.symbol}
                      </button>
                      <a
                        href={`/stock/${stock.symbol}`}
                        className="rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white transition"
                        title={`${stock.symbol}: live NAV, DEX price, chart and token details`}
                      >
                        Details
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real price history: Chainlink NAV vs DEX */}
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
              walletConnected={Boolean(walletAddress)}
              pending={basketPending}
              pendingLabel={basketStatus || "Working…"}
            />

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
                    Dividend-Adjusted Multiplier Active (NVDAc, METAc, GOOGLc &gt; 1.000x)
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
                      <th className="py-3.5 px-4 text-right">Chainlink 24/5 NAV</th>
                      <th className="py-3.5 px-4 text-right">24/7 DEX vs Oracle Gap</th>
                      <th className="py-3.5 px-4 text-right">B20 uiMultiplier</th>
                      <th className="py-3.5 px-4 text-right">Onchain Supply (Shares UI)</th>
                      <th className="py-3.5 px-4 text-right">Base Market Cap</th>
                      {Object.keys(walletBalances).length > 0 && (
                        <th className="py-3.5 px-4 text-right text-cyan-400">Wallet balanceOfUI</th>
                      )}
                      <th className="py-3.5 px-4 text-center">Contracts & prospectus</th>
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
                            <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">
                              {stock.sector}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono">
                            <div className="inline-flex items-center justify-end gap-1.5 text-sm font-bold text-white">
                              ${stock.navPrice.toFixed(2)}
                            </div>
                            <div
                              className={`text-[11px] font-medium ${
                                stock.change24hPct >= 0 ? "text-emerald-400" : "text-rose-400"
                              }`}
                            >
                              {stock.change24hPct >= 0 ? "+" : ""}
                              {stock.change24hPct.toFixed(2)}% ({fmtAge(stock.oracleAgeMinutes ?? 3)})
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono">
                            <div className="text-xs font-bold text-slate-200">
                              DEX: ${(stock.dexPrice24_7 ?? stock.navPrice).toFixed(2)} (
                              {(stock.weekendGapPct ?? 0) >= 0 ? "+" : ""}
                              {(stock.weekendGapPct ?? 0).toFixed(2)}%)
                            </div>
                            <div className="flex items-center justify-end gap-1.5 mt-0.5">
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
                              {stock.dexLiquidityUsd && (
                                <a
                                  href={stock.dexUrl || "#"}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[10px] text-cyan-400 hover:underline"
                                  title="Live Aerodrome Base Pool Liquidity"
                                >
                                  ${(stock.dexLiquidityUsd / 1e3).toFixed(0)}K Liq
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
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <button
                                onClick={() => {
                                  setChartSelectedSymbol(stock.symbol);
                                  document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                }}
                                title={`Buy or sell ${stock.symbol}: choose any amount in the Swap panel`}
                                className="inline-flex items-center gap-1 rounded-md border border-[#4C6FFF]/50 bg-[#4C6FFF]/20 px-2 py-1 text-[11px] font-bold text-blue-200 hover:bg-[#4C6FFF]/35 disabled:opacity-60 transition cursor-pointer"
                              >
                                <Zap className="h-3 w-3" />
                                Buy
                              </button>
                              <a
                                href={stock.basescanUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View B20 Precompile on BaseScan"
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 font-mono text-[11px] text-slate-300 hover:border-[#4C6FFF] hover:text-white transition"
                              >
                                {stock.b20Address.slice(0, 6)}..{stock.b20Address.slice(-4)}
                              </a>
                              <a
                                href={`https://basescan.org/address/${stock.chainlinkFeed}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="View Chainlink Oracle Proxy on BaseScan"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] text-cyan-300 hover:border-cyan-400 transition"
                              >
                                Feed
                              </a>
                              <a
                                href={stock.prospectusUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Issuer prospectus (PDF, published by Coinbase)"
                                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/70 px-2 py-1 text-[11px] text-amber-300 hover:border-amber-400 transition"
                              >
                                <FileText className="h-3 w-3" />
                                PDF
                              </a>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
        )}

        {/* =====================================================================
            TAB 2: BASKET AGENT (AGENTIC STOCK FINANCE)
           ===================================================================== */}
        {activeTab === "agent" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Agent Configuration & Strategy Prompt */}
            <div className="lg:col-span-5 space-y-5 lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4C6FFF]/20 border border-[#4C6FFF]/40">
                      <Bot className="h-6 w-6 text-blue-300" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white">
                        MAXXAGENT basket agent
                      </h2>
                      <p className="text-xs text-slate-400">
                        Transparent rules over live onchain data — you decide and sign
                      </p>
                    </div>
                  </div>
                </div>

                {/* Quick Strategy Prompts */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Quick Research Mandates
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      {
                        label: "AI & GPU Compute",
                        logo: "/logos/stocks/NVDAc.png",
                        prompt:
                          "AI and cloud compute leaders (NVDAc, MSFTc, GOOGLc, SNDKc), prefer stocks trading below NAV",
                      },
                      {
                        label: "Frontier tech",
                        logo: "/logos/stocks/SPCXc.png",
                        prompt:
                          "High-beta frontier innovation basket targeting SpaceX (SPCXc), Tesla robotics (TSLAc), and Bitcoin treasury (MSTRc)",
                      },
                      {
                        label: "Defensive mega-caps",
                        logo: "/logos/stocks/AAPLc.png",
                        prompt:
                          "Defensive, lower-beta mega-caps (AAPLc, MSFTc, AMZNc, GOOGLc)",
                      },
                      {
                        label: "Big tech, no crypto",
                        logo: "/logos/stocks/MSFTc.png",
                        prompt: "Big tech, equal weight, 4 stocks, no crypto",
                      },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        onClick={() => {
                          setUserPrompt(preset.prompt);
                          triggerStockAgent(stocks, preset.prompt);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs text-slate-200 hover:border-[#4C6FFF] hover:bg-[#4C6FFF]/15 transition cursor-pointer"
                      >
                        <img src={preset.logo} alt="" className="h-4 w-4 rounded-full" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Natural Language Mandate Input */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    What do you want? e.g. &quot;AI and cloud, no Tesla, 3 stocks, equal weight&quot;
                  </label>
                  <textarea
                    rows={3}
                    value={userPrompt}
                    onChange={(e) => setUserPrompt(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-[#050811] p-3 text-xs text-white placeholder-slate-500 focus:border-[#4C6FFF] focus:outline-none"
                    placeholder="Describe your tokenized stock thesis, target sectors, or tickers..."
                  />
                </div>

                {/* Risk Profile & Capital */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Risk profile
                    </label>
                    <select
                      value={riskProfile}
                      onChange={(e) =>
                        setRiskProfile(
                          e.target.value as "Conservative" | "Balanced" | "Aggressive"
                        )
                      }
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white focus:border-[#4C6FFF] focus:outline-none"
                    >
                      <option value="Conservative">Conservative (Low Beta)</option>
                      <option value="Balanced">Balanced</option>
                      <option value="Aggressive">Aggressive (High Beta)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Amount to invest (USD)
                    </label>
                    <input
                      type="number"
                      value={capitalUsd}
                      onChange={(e) => setCapitalUsd(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white focus:border-[#4C6FFF] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Not financial advice: the agent only proposes; the user decides and signs */}
                <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
                  Not financial advice. The agent proposes allocations from live onchain data using
                  transparent rules; you decide and sign every transaction from your own wallet. No
                  returns are promised. Tokenized stocks are for eligible non-US persons only.
                </p>

                <button
                  onClick={() => triggerStockAgent()}
                  disabled={runningAgent}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#4C6FFF] to-cyan-600 px-4 py-3 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:opacity-95 transition cursor-pointer"
                >
                  <Sparkles className="h-4 w-4" />
                  {runningAgent
                    ? "Analysing live data…"
                    : "Run agent"}
                </button>
              </div>

            </div>

            {/* Right column: the agent's proposed basket */}
            <div className="lg:col-span-7 space-y-5">
              {!agentReport && (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-[#0b1120] p-8 text-center text-sm text-slate-400">
                  {runningAgent ? "Analysing live onchain data…" : "Run the agent to get a proposed basket from live NAV, DEX prices and liquidity."}
                </div>
              )}
              {agentReport && (
                <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4 sm:p-6 space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <MaxxAgentMark size={18} />
                        <span className="rounded-md bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 px-2.5 py-0.5 font-mono text-xs font-semibold text-blue-300">
                          {agentReport.strategyName}
                        </span>
                        <span className="text-[11px] text-slate-500">{agentReport.allocations.length} stocks</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-300 leading-relaxed">
                        {agentReport.executiveSummary}
                      </p>
                      {agentReport.interpretation?.length > 0 && (
                        <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-3 py-2" data-testid="agent-interpretation">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">How I read your request</div>
                          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-300 list-disc pl-4">
                            {agentReport.interpretation.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                          `My MAXXAGENT basket of tokenized stocks on @base:\n${agentReport.allocations
                            .slice(0, 5)
                            .map((a) => `• $${a.symbol}: ${(a.targetWeightBps / 100).toFixed(0)}%`)
                            .join("\n")}\n\nBuy the same basket: ${PUBLIC_SITE_URL}/?${basketToQuery(
                            Object.fromEntries(agentReport.allocations.map((a) => [a.symbol, a.targetWeightBps]))
                          )}\n\nNot financial advice. #StocksMaxxing @buildonbase`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-blue-400 hover:text-white transition"
                        title="Share your AI B20 Strategy on X (@buildonbase)"
                      >
                        <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                        Share on X
                      </a>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            shareLinkFor(Object.fromEntries(agentReport.allocations.map((a) => [a.symbol, a.targetWeightBps]))),
                            "share-agent"
                          )
                        }
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white transition cursor-pointer"
                        title="Copy a link that opens this basket for anyone"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiedKey === "share-agent" ? "Link copied!" : "Copy share link"}
                      </button>
                      {hasRegistry && (
                      <button
                        onClick={() =>
                          publishIndexOnchain(
                            agentReport.strategyName,
                            agentReport.strategyTicker,
                            agentReport.allocations.map((a) => ({
                              b20Address: a.b20Address,
                              weightBps: a.targetWeightBps,
                            }))
                          )
                        }
                        disabled={txPending || !hasRegistry}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#4C6FFF]/50 bg-[#4C6FFF]/20 px-3.5 py-2.5 text-xs font-bold text-blue-200 hover:bg-[#4C6FFF]/35 disabled:opacity-50 transition cursor-pointer"
                        title={hasRegistry ? "Publish these weights to StockMaxxIndexRegistry so others can buy the same basket" : "Index registry not deployed yet"}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        {txPending ? publishStatus || "Confirm in wallet…" : "Publish as onchain index"}
                      </button>
                      )}
                    </div>
                  </div>

                  {/* Buy this basket in-app: USDC -> B20 stocks, straight to the user's wallet */}
                  <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/5 p-4 space-y-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-bold text-white">Buy this basket</h3>
                        <p className="text-[11px] text-slate-400">
                          Best route via DEX aggregator on Base. Stocks go directly to your wallet —
                          MAXXAGENT never holds your funds. Routes costing over 1.5% are skipped.
                        </p>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300">
                        Total
                        <span className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                          <input
                            type="number"
                            min={1}
                            max={10000}
                            step={1}
                            value={basketUsd}
                            onChange={(e) => setBasketUsd(Math.max(0, Number(e.target.value) || 0))}
                            className="w-28 rounded-xl border border-slate-700 bg-[#050811] py-2 pl-6 pr-2 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
                          />
                        </span>
                        {payToggle}
                      </label>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {agentReport.allocations.map((a) => {
                        const legUsd = (basketUsd * a.targetWeightBps) / 10000;
                        return (
                          <span
                            key={a.symbol}
                            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                              legUsd >= 1
                                ? "border-slate-700 bg-slate-900 text-slate-200"
                                : "border-slate-800 bg-slate-900/40 text-slate-500 line-through"
                            }`}
                            title={legUsd >= 1 ? undefined : "Below $1 minimum — will be skipped"}
                          >
                            <img src={a.logoUrl || STOCK_LOGO_MAP[a.symbol]} alt="" className="h-3.5 w-3.5 rounded-full" />
                            {a.symbol} ${legUsd.toFixed(2)}
                          </span>
                        );
                      })}
                    </div>

                    <button
                      onClick={() =>
                        buyStocks(
                          agentReport.allocations.map((a) => ({
                            symbol: a.symbol,
                            b20Address: a.b20Address,
                            usd: Math.floor(((basketUsd * a.targetWeightBps) / 10000) * 100) / 100,
                            payWith: basketPayWith,
                          })),
                          agentReport.strategyName
                        )
                      }
                      disabled={basketPending || basketUsd < 1}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-60 transition cursor-pointer"
                    >
                      <Zap className="h-4 w-4" />
                      {basketPending ? basketStatus || "Working…" : `Buy basket for $${basketUsd.toFixed(2)} ${payLabel}`}
                    </button>

                    {basketError && (
                      <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {basketError}
                      </div>
                    )}

                    {basketResult && (
                      <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 space-y-1">
                        <div className="font-bold">
                          Received onchain:{" "}
                          {basketResult.received.length > 0
                            ? basketResult.received
                                .map((r) => `${r.tokens.toFixed(6)} ${r.symbol}${r.quotedTokens ? ` (quoted ${r.quotedTokens.toFixed(6)})` : ""}`)
                                .join(", ")
                            : "reading receipts…"}
                        </div>
                        {basketResult.skipped.length > 0 && (
                          <div className="text-amber-200">
                            Skipped: {basketResult.skipped.map((s) => `${s.symbol} — ${s.error}`).join(" · ")}
                          </div>
                        )}
                        {basketResult.failed?.length > 0 && (
                          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-100">
                            Partly completed. Not completed: {basketResult.failed.map((f) => `${f.label} (${f.error})`).join(" · ")}. The other
                            stocks went through.
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {(basketResult.txs.length ? basketResult.txs : basketResult.txHashes.map((h) => ({ hash: h, status: "unknown" as const }))).map((t) => (
                            <a
                              key={t.hash}
                              href={`https://basescan.org/tx/${t.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 font-mono underline hover:text-white"
                              title={`Status: ${t.status}`}
                            >
                              <span className={t.status === "confirmed" ? "text-emerald-300" : t.status === "failed" ? "text-rose-300" : "text-slate-400"}>
                                {t.status === "confirmed" ? "✓" : t.status === "failed" ? "✕" : "…"}
                              </span>
                              {t.hash.slice(0, 10)}… on BaseScan
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Rebalance the wallet's current stocks toward this basket (sell overweight, then buy underweight) */}
                  {walletAddress && balancesFor === walletAddress.toLowerCase() && (
                    <RebalancePanel
                      stocks={stocks}
                      balances={walletBalances}
                      usdcBalance={usdcBalance}
                      targets={agentReport.allocations.map((a) => ({ symbol: a.symbol, b20Address: a.b20Address, weightBps: a.targetWeightBps }))}
                      targetLabel={agentReport.strategyName}
                      pending={basketPending}
                      onSell={(legs, label) => sellStocks(legs, label)}
                      onBuy={(legs, label) => buyStocks(legs, label)}
                    />
                  )}

                  {/* Interactive SVG Donut Chart for Agent Portfolio */}
                  <div className="rounded-2xl border border-slate-800/90 bg-[#050914]/90 p-4">
                    <PortfolioDonutChart
                      items={agentReport.allocations.map((a) => ({
                        symbol: a.symbol,
                        weightBps: a.targetWeightBps,
                        color: a.color || STOCK_COLOR_MAP[a.symbol] || "#4C6FFF",
                        logoUrl: a.logoUrl || STOCK_LOGO_MAP[a.symbol],
                      }))}
                      centerLabel="Capital"
                      centerValue={`$${agentReport.portfolioCapitalUsd.toLocaleString("en-US")}`}
                    />
                  </div>

                  {/* Live basket snapshot (no projections) */}
                  <BasketSnapshotCard allocations={agentReport.allocations} />

                  {/* Allocations Table with Official Stock Logos */}
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                      Allocation and why each stock was picked
                    </h3>
                    <div className="space-y-3">
                      {agentReport.allocations.map((alloc) => (
                        <div
                          key={alloc.symbol}
                          className="rounded-xl border border-slate-800/90 bg-[#070b14] p-4 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <img
                                src={alloc.logoUrl || STOCK_LOGO_MAP[alloc.symbol]}
                                alt={alloc.companyName}
                                className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 object-cover"
                              />
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-bold text-white">
                                    {alloc.symbol}
                                  </span>
                                  <span className="hidden sm:inline text-xs text-slate-400">
                                    {alloc.companyName}
                                  </span>
                                  <span
                                    className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
                                      alloc.action === "ACCUMULATE"
                                        ? "bg-emerald-500/20 text-emerald-300"
                                        : alloc.action === "TRIM"
                                        ? "bg-amber-500/20 text-amber-300"
                                        : "bg-slate-800 text-slate-300"
                                    }`}
                                  >
                                    {alloc.action === "ACCUMULATE" ? "BUY" : alloc.action === "TRIM" ? "TRIM" : "HOLD"}{" "}
                                    {alloc.deltaBps >= 0 ? "+" : ""}
                                    {(alloc.deltaBps / 100).toFixed(1)}%
                                  </span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
                              <span className="text-slate-400" title="Rule score relative to the other candidates: the best one is 99, the weakest 50">
                                Score <strong className="text-cyan-400">{alloc.quantScore}</strong>
                              </span>
                              <span className="text-white font-bold">
                                {(alloc.targetWeightBps / 100).toFixed(1)}% · ${alloc.usdAllocation.toFixed(2)}
                              </span>
                              <span className="text-emerald-400">
                                ≈ {alloc.estimatedSharesUI.toFixed(3)} share-equivalent
                              </span>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[#4C6FFF] to-cyan-400"
                              style={{ width: `${alloc.targetWeightBps / 100}%` }}
                            />
                          </div>

                          {alloc.reasons?.length ? (
                            <p className="text-[11px] text-slate-400">
                              <span className="text-slate-300">Why: </span>
                              {alloc.reasons.join(" · ")}. DEX ${alloc.dexPrice24_7.toFixed(2)} vs NAV ${alloc.navPrice.toFixed(2)}.
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-400">{alloc.rationale}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Attributed calldata preview: developer detail, team studio only (the registry is not deployed) */}
                  {studioMode && (
                  <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                        <Code2 className="h-4 w-4 text-[#4C6FFF]" />
                        ERC-8021 Attributed Transaction Calldata (
                        {agentReport.onchainExecution.targetContractDescription})
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setProMode((p) => !p)}
                          className="text-slate-400 hover:text-white underline cursor-pointer"
                        >
                          {proMode ? "Hide Raw Hex" : "Inspect Raw Hex (Pro)"}
                        </button>
                        <button
                          onClick={() =>
                            copyToClipboard(
                              agentReport.onchainExecution.attributedCalldata,
                              "agent-calldata"
                            )
                          }
                          className="text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Copy className="h-3 w-3" />
                          {copiedKey === "agent-calldata" ? "Copied!" : "Copy Hex"}
                        </button>
                      </div>
                    </div>
                    {proMode ? (
                      <>
                        <p className="font-mono text-[11px] text-slate-400 break-all leading-relaxed">
                          {agentReport.onchainExecution.rawCalldata}
                          <span className="bg-emerald-500/20 text-emerald-300 font-bold px-1 rounded">
                            {agentReport.erc8021Suffix.slice(2)}
                          </span>
                        </p>
                        <p className="text-[11px] text-emerald-400">
                          ↑ Highlighted green suffix is the official ERC-8021 Base Builder Code
                          attribution payload (`{agentReport.erc8021Suffix}`).
                        </p>
                      </>
                    ) : (
                      <p className="text-[11px] text-emerald-400">
                        ✓ Ready to broadcast with ERC-8021 Builder Code suffix (
                        <code className="font-mono">{agentReport.erc8021Suffix.slice(0, 22)}...</code>
                        ). Switch to <strong>Pro / Developer View</strong> to inspect full ABI hex.
                      </p>
                    )}
                  </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 3: NON-CUSTODIAL INDEX REGISTRY
           ===================================================================== */}
        {activeTab === "indexes" && (
          <div className="space-y-6">
            {/* Preset Index Cards with Official Stock & Partner Logos */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {PROGRAMMABLE_INDEX_PRESETS.map((preset) => {
                const isSelected = selectedPreset.id === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => {
                      setSelectedPreset(preset);
                      setCustomIndexName(preset.name);
                      setCustomIndexTicker(preset.ticker);
                      const map: Record<string, number> = {};
                      preset.allocations.forEach((a) => {
                        map[a.symbol] = a.weightBps;
                      });
                      setCustomWeights(map);
                    }}
                    className={`rounded-2xl border p-5 transition cursor-pointer ${
                      isSelected
                        ? "border-[#4C6FFF] bg-[#0b152e] shadow-lg shadow-[#4C6FFF]/20"
                        : "border-slate-800 bg-[#0b1120] hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="rounded-md bg-[#4C6FFF]/20 border border-[#4C6FFF]/40 px-2.5 py-0.5 font-mono text-xs font-bold text-blue-300">
                        {preset.ticker}
                      </span>
<span className="text-[11px] font-mono text-slate-400">{preset.riskLevel}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-bold text-white">{preset.name}</h3>
                      <div className="flex -space-x-2 shrink-0">
                        {preset.allocations.map((a) => (
                          <img
                            key={a.symbol}
                            src={STOCK_LOGO_MAP[a.symbol]}
                            alt={a.symbol}
                            className="h-6 w-6 rounded-full ring-2 ring-[#0b1120] bg-slate-900 object-cover"
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{preset.tagline}</p>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {preset.allocations.map((a) => (
                        <span
                          key={a.symbol}
                          className="inline-flex items-center gap-1 rounded bg-slate-800/90 px-2 py-0.5 font-mono text-[11px] text-slate-200"
                        >
                          <img
                            src={STOCK_LOGO_MAP[a.symbol]}
                            alt={a.symbol}
                            className="h-3.5 w-3.5 rounded-full"
                          />
                          {a.symbol} {(a.weightBps / 100).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Interactive Programmable Index Constructor */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div id="index-builder" className={`${hasRegistry ? "lg:col-span-7" : "lg:col-span-12"} rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5 scroll-mt-24`}>
                {sharedBasketLoaded && (
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/10 p-3 text-xs text-cyan-100">
                    <span>
                      <strong>Shared basket loaded.</strong> Check the weights and the amount below, then buy from your own wallet.
                      Nothing happens until you confirm.
                    </span>
                    <button onClick={() => setSharedBasketLoaded(false)} aria-label="Dismiss" className="text-cyan-200 hover:text-white cursor-pointer">
                      ✕
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                  <div className="flex items-center gap-2.5">
                    <MaxxAgentMark size={28} />
                    <div>
                      <h3 className="text-base font-bold text-white">
                        Build your own index
                      </h3>
                      <p className="text-xs text-slate-400">
                        Pick up to 10 stocks, set the weights, then buy the basket or share it as a link
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={normalizeCustomWeights}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/25 transition cursor-pointer"
                  >
                    Normalize to 100%
                  </button>
                </div>

                <div className={`grid grid-cols-1 gap-3 ${hasRegistry ? "sm:grid-cols-2" : ""}`}>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Index Name
                    </label>
                    <input
                      type="text"
                      value={customIndexName}
                      onChange={(e) => setCustomIndexName(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white"
                    />
                  </div>
                  {/* The ticker only matters for publishing to the registry */}
                  {hasRegistry && (
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Index Ticker Symbol
                    </label>
                    <input
                      type="text"
                      value={customIndexTicker}
                      onChange={(e) => setCustomIndexTicker(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white"
                    />
                  </div>
                  )}
                </div>

                {/* Interactive SVG Donut Chart for Custom Index Basket */}
                <div className="rounded-2xl border border-slate-800/90 bg-[#050914]/90 p-4">
                  <PortfolioDonutChart
                    items={Object.entries(customWeights)
                      .filter(([, w]) => w > 0)
                      .map(([sym, w]) => ({
                        symbol: sym,
                        weightBps: w,
                        color: STOCK_COLOR_MAP[sym] || "#4C6FFF",
                        logoUrl: STOCK_LOGO_MAP[sym],
                      }))}
                    centerLabel={customIndexTicker}
                    centerValue={`${(totalCustomWeightBps / 100).toFixed(0)}%`}
                  />
                </div>

                {/* Sliders for all 10 Coinbase B20 Tokenized Stocks with Official Logos */}
                <div className={`grid grid-cols-1 gap-3 ${hasRegistry ? "" : "xl:grid-cols-2"}`}>
                  {stocks.map((stock) => {
                    const weightBps = customWeights[stock.symbol] || 0;
                    return (
                      <div
                        key={stock.symbol}
                        className="rounded-xl border border-slate-800/80 bg-[#070b14] p-3 flex items-center justify-between gap-3 sm:gap-4"
                      >
                        <div className="flex items-center gap-2.5 w-28 sm:w-44 shrink-0">
                          <img
                            src={stock.logoUrl}
                            alt={stock.companyName}
                            className="h-8 w-8 rounded-full border border-slate-700 bg-slate-900 object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-white">
                                {stock.symbol}
                              </span>
                              <span className="font-mono text-[11px] text-slate-400">
                                ${stock.navPrice.toFixed(0)}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-500 truncate">
                              {stock.companyName}
                            </div>
                          </div>
                        </div>

                        <input
                          type="range"
                          min={0}
                          max={6000}
                          step={100}
                          value={weightBps}
                          onChange={(e) =>
                            setCustomWeights((prev) => ({
                              ...prev,
                              [stock.symbol]: Number(e.target.value),
                            }))
                          }
                          className="flex-1 min-w-0 accent-[#4C6FFF] cursor-pointer"
                          aria-label={`${stock.symbol} weight`}
                        />

                        <div className="w-14 sm:w-24 shrink-0 text-right font-mono text-xs font-bold text-white">
                          {(weightBps / 100).toFixed(1)}%
                          <span className="hidden sm:inline text-[10px] font-normal text-slate-400">
                            {" "}({weightBps} bps)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-slate-800">{amountControl}</div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-400">
                    Total Weight:{" "}
                    <strong
                      className={`font-mono ${
                        totalCustomWeightBps === 10000 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {totalCustomWeightBps} / 10,000 bps (
                      {(totalCustomWeightBps / 100).toFixed(2)}%)
                    </strong>
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={`https://x.com/intent/tweet?text=${encodeURIComponent(
                        `My tokenized stock index [${customIndexTicker}] (${customIndexName}) on @base, built with MAXXAGENT:\n${Object.entries(
                          customWeights
                        )
                          .filter(([, w]) => w > 0)
                          .slice(0, 5)
                          .map(([s, w]) => `• $${s}: ${(w / 100).toFixed(0)}%`)
                          .join("\n")}\n\nBuy the same index: ${PUBLIC_SITE_URL}/?${basketToQuery(customWeights)}\n\nNot financial advice. #StocksMaxxing @buildonbase`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/90 px-3 py-2.5 text-xs font-bold text-slate-200 hover:border-blue-400 hover:text-white transition"
                    >
                      <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                      Share Index on X
                    </a>
                    <button
                      onClick={() => copyToClipboard(shareLinkFor(customWeights), "share-index")}
                      disabled={totalCustomWeightBps !== 10000}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2.5 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white disabled:opacity-50 transition cursor-pointer"
                      title="Copy a link that opens this index for anyone"
                    >
                      <Copy className="h-4 w-4" />
                      {copiedKey === "share-index" ? "Link copied!" : "Copy share link"}
                    </button>
                    <button
                      onClick={() =>
                        buyStocks(
                          Object.entries(customWeights)
                            .filter(([, w]) => w > 0)
                            .map(([sym, w]) => ({
                              symbol: sym,
                              b20Address:
                                BASE_TOKENIZED_STOCKS.find((s) => s.symbol === sym)?.b20Address ?? "",
                              usd: Math.floor(((basketUsd * w) / Math.max(1, totalCustomWeightBps)) * 100) / 100,
                              payWith: basketPayWith,
                            })),
                          customIndexTicker
                        )
                      }
                      disabled={basketPending || totalCustomWeightBps !== 10000}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
                    >
                      <Zap className="h-4 w-4" />
                      {basketPending ? basketStatus || "Working…" : `Buy for $${basketUsd} ${payLabel}`}
                    </button>
                    {hasRegistry && (
                    <button
                      onClick={() =>
                        publishIndexOnchain(
                          customIndexName,
                          customIndexTicker,
                          Object.entries(customWeights).map(([sym, w]) => ({
                            b20Address: BASE_TOKENIZED_STOCKS.find((s) => s.symbol === sym)?.b20Address ?? "",
                            weightBps: w,
                          }))
                        )
                      }
                      disabled={txPending || !hasRegistry || totalCustomWeightBps !== 10000}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:bg-[#3D5BEA] disabled:opacity-50 transition cursor-pointer"
                      title={hasRegistry ? "Publish to StockMaxxIndexRegistry" : "Index registry not deployed yet"}
                    >
                      <Layers className="h-4 w-4" />
                      {txPending ? publishStatus || "Confirm in wallet…" : "Publish onchain"}
                    </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Onchain index registry: published indexes anyone can buy (hidden until the registry is deployed) */}
              {hasRegistry && (
              <div className="lg:col-span-5 self-start rounded-3xl border border-slate-800 bg-gradient-to-b from-[#0d1428] to-[#0b1120] p-5 sm:p-6 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl border border-[#4C6FFF]/40 bg-[#4C6FFF]/15">
                      <Layers className="h-5 w-5 text-blue-300" />
                    </div>
                    <div>
                      <h3 className="flex items-center gap-2 text-base font-bold text-white">
                        Published indexes
                        {publishedIndexes.length > 0 && (
                          <span className="rounded-full bg-[#4C6FFF]/20 px-2 py-0.5 font-mono text-[11px] text-blue-200">{publishedIndexes.length}</span>
                        )}
                      </h3>
                      <p className="text-[11px] text-slate-400">Onchain baskets anyone can buy in one click</p>
                    </div>
                  </div>
                  <button
                    onClick={() => loadPublishedIndexes()}
                    className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white cursor-pointer"
                    title="Refresh"
                    aria-label="Refresh published indexes"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${indexesStatus === "Loading…" ? "animate-spin" : ""}`} />
                  </button>
                </div>

                <a
                  href={`https://basescan.org/address/${registryAddress}#code`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-[11px] text-slate-300 hover:border-emerald-400/50"
                >
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
                    Registry verified on BaseScan · holds no funds, no fees
                  </span>
                  <ExternalLink className="h-3 w-3 text-slate-500" />
                </a>

                {/* Amount per buy */}
                <div className="rounded-2xl border border-slate-800 bg-[#070b14] p-3 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Amount per buy</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[10, 20, 50, 100].map((v) => (
                      <button
                        key={v}
                        onClick={() => setBasketUsd(v)}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-bold cursor-pointer ${
                          basketUsd === v ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-slate-700 text-slate-300 hover:border-slate-500"
                        }`}
                      >
                        ${v}
                      </button>
                    ))}
                    <span className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">$</span>
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        step={1}
                        value={basketUsd || ""}
                        onChange={(e) => setBasketUsd(Math.max(0, Number(e.target.value) || 0))}
                        className="w-20 rounded-lg border border-slate-700 bg-[#050811] py-1 pl-5 pr-1.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                        aria-label="Amount per index buy in USD"
                      />
                    </span>
                    <span className="ml-auto">{payToggle}</span>
                  </div>
                </div>

                {publishedIndexes.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-800 p-5 text-center text-xs text-slate-400">
                    {indexesStatus === "Loading…"
                      ? "Loading published indexes…"
                      : indexesStatus && !/published/.test(indexesStatus)
                      ? `Could not load indexes: ${indexesStatus}`
                      : "No indexes published yet — publish the first one."}
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[640px] overflow-y-auto pr-1">
                    {publishedIndexes.map((ix) => (
                      <div
                        key={ix.id}
                        className="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#101a33] to-[#070b14] p-4 space-y-3 transition hover:border-[#4C6FFF]/60"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex shrink-0 -space-x-2">
                              {ix.constituents.slice(0, 4).map((c) => (
                                <img
                                  key={c.b20Address}
                                  src={STOCK_LOGO_MAP[c.symbol]}
                                  alt=""
                                  className="h-8 w-8 rounded-full bg-slate-900 object-cover ring-2 ring-[#0b1120]"
                                />
                              ))}
                            </div>
                            <div className="min-w-0">
                              <a href={`/index/${ix.id}`} className="block text-sm font-bold leading-snug text-white hover:text-cyan-300 line-clamp-2">
                                {ix.name}
                              </a>
                              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                                <span className="rounded bg-[#4C6FFF]/20 px-1.5 py-0.5 font-mono font-bold text-blue-200">{ix.ticker}</span>
                                <span className="font-mono text-slate-500">
                                  #{ix.id} · by {ix.creator.slice(0, 6)}…{ix.creator.slice(-4)}
                                </span>
                              </div>
                            </div>
                          </div>
                          <span className="hidden sm:inline-flex shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Onchain
                          </span>
                        </div>

                        {/* Weights: one stacked bar + legend */}
                        <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          {ix.constituents.map((c) => (
                            <div
                              key={c.b20Address}
                              style={{ width: `${c.weightBps / 100}%`, backgroundColor: STOCK_COLOR_MAP[c.symbol] || "#4C6FFF" }}
                              title={`${c.symbol} ${(c.weightBps / 100).toFixed(1)}%`}
                            />
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
                          {ix.constituents.map((c) => (
                            <div key={c.b20Address} className="flex items-center gap-1.5 text-[11px]">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STOCK_COLOR_MAP[c.symbol] || "#4C6FFF" }} />
                              <span className="font-mono text-slate-200">{c.symbol}</span>
                              <span className="ml-auto font-mono text-slate-400">{(c.weightBps / 100).toFixed(0)}%</span>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() =>
                              buyStocks(
                                ix.constituents.map((c) => ({
                                  symbol: c.symbol,
                                  b20Address: c.b20Address,
                                  usd: Math.floor(((basketUsd * c.weightBps) / 10000) * 100) / 100,
                                  payWith: basketPayWith,
                                })),
                                ix.ticker
                              )
                            }
                            disabled={basketPending || basketUsd < 1}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-50 transition cursor-pointer"
                          >
                            <Zap className="h-3.5 w-3.5" />
                            {basketPending ? basketStatus || "Working…" : `Buy $${basketUsd} ${payLabel}`}
                          </button>
                          <a
                            href={`/index/${ix.id}`}
                            className="rounded-xl border border-slate-700 px-3 py-2.5 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white"
                          >
                            Details
                          </a>
                          <button
                            onClick={() => copyToClipboard(`${window.location.origin}/index/${ix.id}`, `index-link-${ix.id}`)}
                            className="grid h-[38px] w-[38px] place-items-center rounded-xl border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white cursor-pointer"
                            title="Copy link"
                            aria-label={`Copy link to ${ix.ticker}`}
                          >
                            {copiedKey === `index-link-${ix.id}` ? <Check className="h-4 w-4 text-emerald-300" /> : <Copy className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 4: ERC-8021 BUILDER CODE & ONCHAIN TRACTION LAB (50% JUDGING WEIGHT)
           ===================================================================== */}
        {activeTab === "traction" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Holdings */}
            <div className="lg:col-span-12 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-white">Your tokenized stocks</h2>
                  <p className="text-xs text-slate-400">
                    Read live from Base for your connected wallet. Values use the Chainlink NAV.
                  </p>
                </div>
                {walletAddress ? (
                  <button
                    onClick={() => fetchLiveStocks(walletAddress)}
                    disabled={loadingStocks}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingStocks ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      window.scrollTo({ top: 0, behavior: "smooth" });
                      setShowWalletMenu(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-4 py-2 text-xs font-bold text-white hover:brightness-110 transition cursor-pointer"
                  >
                    <Wallet className="h-3.5 w-3.5" />
                    Connect wallet
                  </button>
                )}
              </div>

              {!walletAddress ? (
                <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400 space-y-3">
                  <p className="text-sm text-slate-200">Connect a wallet to see your holdings.</p>
                  <ul className="mx-auto max-w-md space-y-1 text-left text-[11px] text-slate-400 list-disc pl-5">
                    <li>Each tokenized stock you hold, valued at the live Chainlink NAV</li>
                    <li>Profit / loss since you bought, from the USDC or ETH you actually paid</li>
                    <li>Your buy and sell history, with a BaseScan link for every trade</li>
                    <li>One-click sell, and rebalancing toward an agent basket</li>
                  </ul>
                  <p className="text-[11px] text-slate-500">Read-only: connecting never moves funds. No stocks yet?</p>
                  <button
                    onClick={() => setActiveTab("terminal")}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 px-3.5 py-2 text-xs font-bold text-slate-200 hover:border-cyan-400 hover:text-white cursor-pointer"
                  >
                    Browse the 10 stocks
                  </button>
                </div>
              ) : (
                balancesFor !== walletAddress.toLowerCase() ? (
                  <div className="space-y-3" aria-busy="true">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-[62px] rounded-xl border border-slate-800 bg-[#070b14] animate-pulse" />
                      ))}
                    </div>
                    {balancesError && !loadingStocks ? (
                      <div className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed border-amber-500/40 p-6 text-xs text-amber-200">
                        {balancesError}
                        <button
                          onClick={() => fetchLiveStocks(walletAddress)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 font-semibold text-white hover:bg-slate-800 cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-800 p-6 text-xs text-slate-400">
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Reading your balances from Base…
                      </div>
                    )}
                  </div>
                ) : (() => {
                  const rows = stocks
                    .map((st) => ({ st, bal: walletBalances[st.symbol] }))
                    .filter((r) => (r.bal?.rawTokens ?? 0) > 0);
                  const totalUsd = rows.reduce((a, r) => a + (r.bal?.usdValue ?? 0), 0);
                  const pnlData = pnl.for === walletAddress.toLowerCase() ? pnl.data : null;
                  const pnlPending = pnl.for !== walletAddress.toLowerCase();
                  // Unrealized P/L = live value (NAV x live balance) - average cost x live balance
                  const rowPnl = (sym: string, value: number, tokens: number) => {
                    const pos = pnlData?.positions.find((x) => x.symbol === sym);
                    if (!pos || pos.avgCostUsd === null) return null;
                    const cost = pos.avgCostUsd * tokens;
                    return { cost, pl: value - cost, pct: cost > 0 ? ((value - cost) / cost) * 100 : 0, est: pos.estimated };
                  };
                  const rowsPnl = rows.map((r) => rowPnl(r.st.symbol, r.bal?.usdValue ?? 0, r.bal?.rawTokens ?? 0));
                  const totalCost = rowsPnl.reduce((a, x) => a + (x?.cost ?? 0), 0);
                  const totalPl = rowsPnl.reduce((a, x) => a + (x?.pl ?? 0), 0);
                  const anyEst = rowsPnl.some((x) => x?.est);
                  const money = (n: number) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
                  const tone = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-rose-300" : "text-slate-300");
                  const pnlPlaceholder = pnlPending ? "…" : "—";
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono">
                        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                          <div className="text-[10px] font-sans text-slate-400">Stocks value</div>
                          <div className="text-lg font-extrabold text-white">${totalUsd.toFixed(2)}</div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3">
                          <div className="text-[10px] font-sans text-slate-400">USDC on Base</div>
                          <div className="text-lg font-extrabold text-emerald-300">
                            {usdcBalance === null ? "—" : `$${usdcBalance.toFixed(2)}`}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Stocks at NAV + USDC + ETH in this wallet">
                          <div className="text-[10px] font-sans text-slate-400">Total balance</div>
                          <div className="text-lg font-extrabold text-cyan-300">
                            ${(totalUsd + (usdcBalance ?? 0) + (ethBalance !== null && ethUsd ? ethBalance * ethUsd : 0)).toFixed(2)}
                          </div>
                          <div className="text-[10px] font-sans text-slate-500">
                            {rows.length} stock{rows.length === 1 ? "" : "s"}
                            {ethBalance !== null ? ` · ${ethBalance.toFixed(4)} ETH` : ""}
                          </div>
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Live value minus what you paid (average cost)">
                          <div className="text-[10px] font-sans text-slate-400">Unrealized P/L{anyEst ? " (est.)" : ""}</div>
                          <div className={`text-lg font-extrabold ${pnlData && totalCost > 0 ? tone(totalPl) : "text-slate-300"}`}>
                            {pnlData && totalCost > 0 ? money(totalPl) : pnlPlaceholder}
                          </div>
                          {pnlData && totalCost > 0 && (
                            <div className={`text-[10px] ${tone(totalPl)}`}>{((totalPl / totalCost) * 100).toFixed(2)}%</div>
                          )}
                        </div>
                        <div className="rounded-xl border border-slate-800 bg-[#070b14] p-3" title="Gains or losses already locked in by selling">
                          <div className="text-[10px] font-sans text-slate-400">Realized P/L</div>
                          <div className={`text-lg font-extrabold ${pnlData ? tone(pnlData.realizedUsd) : "text-slate-300"}`}>
                            {pnlData ? money(pnlData.realizedUsd) : pnlPlaceholder}
                          </div>
                        </div>
                      </div>
                      {rows.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                          No tokenized stocks in this wallet yet.{" "}
                          <button onClick={() => setActiveTab("agent")} className="text-cyan-300 underline cursor-pointer">
                            Buy your first basket
                          </button>
                          .
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          {totalUsd > 0 && (
                            <div className="mb-3 space-y-2">
                              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                                {rows.map(({ st, bal }) => (
                                  <div
                                    key={st.symbol}
                                    style={{ width: `${((bal?.usdValue ?? 0) / totalUsd) * 100}%`, backgroundColor: STOCK_COLOR_MAP[st.symbol] || "#4C6FFF" }}
                                    title={`${st.symbol} ${(((bal?.usdValue ?? 0) / totalUsd) * 100).toFixed(1)}%`}
                                  />
                                ))}
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                                {rows.map(({ st, bal }) => (
                                  <span key={st.symbol} className="inline-flex items-center gap-1.5 text-slate-300">
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STOCK_COLOR_MAP[st.symbol] || "#4C6FFF" }} />
                                    <span className="font-mono">{st.symbol}</span>
                                    <span className="font-mono text-slate-500">{(((bal?.usdValue ?? 0) / totalUsd) * 100).toFixed(0)}%</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 border-b border-slate-800">
                                <th className="py-2 pr-3">Stock</th>
                                <th className="hidden sm:table-cell py-2 pr-3 text-right">Amount</th>
                                <th className="hidden sm:table-cell py-2 pr-3 text-right">NAV</th>
                                <th className="py-2 pr-3 text-right">Value</th>
                                <th className="hidden sm:table-cell py-2 pr-3 text-right">Avg cost</th>
                                <th className="py-2 pr-3 text-right">P/L</th>
                                <th className="hidden sm:table-cell py-2 pr-3 text-right">Weight</th>
                                <th className="py-2 text-right">Trade</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map(({ st, bal }, ri) => (
                                <tr key={st.symbol} className="border-b border-slate-800/60 font-mono">
                                  <td className="py-2.5 pr-3">
                                    <a href={`/stock/${st.symbol}`} className="inline-flex items-center gap-2 whitespace-nowrap font-sans font-semibold text-white hover:text-cyan-300">
                                      <img src={st.logoUrl} alt="" className="h-5 w-5 shrink-0 rounded-full" />
                                      {st.symbol}
                                    </a>
                                  </td>
                                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300" title="Token amount; the share-equivalent includes reinvested dividends">
                                    {(bal?.rawTokens ?? 0).toFixed(6)}
                                    <span className="block text-[10px] text-slate-500">≈ {(bal?.sharesUI ?? 0).toFixed(6)} sh</span>
                                  </td>
                                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300">${st.navPrice.toFixed(2)}</td>
                                  <td className="py-2.5 pr-3 text-right font-bold text-white">${(bal?.usdValue ?? 0).toFixed(2)}</td>
                                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-slate-300">
                                    {(() => {
                                      const avg = pnlData?.positions.find((x) => x.symbol === st.symbol)?.avgCostUsd;
                                      return typeof avg === "number" ? `$${avg.toFixed(2)}` : pnlPlaceholder;
                                    })()}
                                  </td>
                                  <td className="py-2.5 pr-3 text-right whitespace-nowrap">
                                    {rowsPnl[ri] ? (
                                      <span className={tone(rowsPnl[ri]!.pl)}>
                                        {money(rowsPnl[ri]!.pl)}
                                        <span className="block text-[10px]">
                                          {rowsPnl[ri]!.pct >= 0 ? "+" : ""}
                                          {rowsPnl[ri]!.pct.toFixed(2)}%{rowsPnl[ri]!.est ? " est." : ""}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="text-slate-500">{pnlPlaceholder}</span>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell py-2.5 pr-3 text-right text-cyan-300">
                                    {totalUsd > 0 ? (((bal?.usdValue ?? 0) / totalUsd) * 100).toFixed(1) : "0.0"}%
                                  </td>
                                  <td className="py-2.5 text-right font-sans w-[6.75rem] sm:w-auto">
                                    {/* phones: Buy on top, 50% / All below, so the row fits a 390px screen */}
                                    <div className="inline-flex flex-wrap justify-end gap-1.5">
                                      <button
                                        onClick={() => {
                                          setChartSelectedSymbol(st.symbol);
                                          setActiveTab("terminal");
                                          setTimeout(() => document.getElementById("swap-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }), 350);
                                        }}
                                        title={`Buy more ${st.symbol}`}
                                        className="rounded-lg border border-[#4C6FFF]/50 bg-[#4C6FFF]/15 px-2.5 py-1.5 text-[11px] font-bold text-blue-200 hover:bg-[#4C6FFF]/30 cursor-pointer"
                                      >
                                        Buy
                                      </button>
                                      {[
                                        { label: "50%", pct: 0.5 },
                                        { label: "All", pct: 1 },
                                      ].map((o) => (
                                        <button
                                          key={o.label}
                                          onClick={() =>
                                            sellStocks(
                                              [{ symbol: st.symbol, b20Address: st.b20Address, tokens: (bal?.rawTokens ?? 0) * o.pct }],
                                              st.symbol
                                            )
                                          }
                                          disabled={basketPending || (bal?.usdValue ?? 0) * o.pct < 0.25}
                                          title={
                                            (bal?.usdValue ?? 0) * o.pct < 0.25
                                              ? "Minimum sell value is $0.25"
                                              : `Sell ${o.label} of ${st.symbol} for USDC`
                                          }
                                          className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1.5 text-[11px] font-bold text-rose-200 hover:bg-rose-500/20 disabled:opacity-40 cursor-pointer"
                                        >
                                          {o.label}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
                            P/L uses the USDC or ETH you actually paid, read from your onchain history, against the live Chainlink NAV.
                            {anyEst ? " est. = part of the cost is valued at the Chainlink NAV when the stock arrived (bought with another token, sent from another wallet, or bought before the history scanned so far)." : ""}
                            {pnl.for === walletAddress.toLowerCase() && pnl.error ? ` ${pnl.error}` : ""}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()
              )}
            </div>

            {/* Trade history rebuilt from the wallet's onchain transfers (same scan as P/L) */}
            {walletAddress && (
              <div className="lg:col-span-12">
                <TradeHistoryPanel
                  entries={pnl.for === walletAddress.toLowerCase() ? pnl.data?.activity ?? [] : []}
                  loading={pnl.for !== walletAddress.toLowerCase()}
                  error={pnl.for === walletAddress.toLowerCase() ? pnl.error : ""}
                  since={pnl.for === walletAddress.toLowerCase() ? pnl.data?.since ?? null : null}
                />
              </div>
            )}

            {/* Activity from this browser (only once something was sent from here) */}
            {activityLog.length > 0 && (
            <div className="lg:col-span-12">
              <OnchainActivityLogPanel
                entries={activityLog}
                onClear={() => {
                  setActivityLog([]);
                  try {
                    window.localStorage.removeItem("maxxagent_activity_log");
                  } catch {}
                }}
              />
            </div>
            )}

            {/* Attribution note (technical details live in the team studio) */}
            <p className="lg:col-span-12 text-[11px] text-slate-500 leading-relaxed">
              MAXXAGENT transactions carry a public{" "}
              <span className="text-slate-400">ERC-8021 Builder Code</span> so activity can be attributed to this app.
              It contains no personal data and you can see it in each transaction&apos;s input data on BaseScan.
            </p>
          </div>
        )}

        {/* =====================================================================
            TAB 5: BUILD IN PUBLIC & SUBMISSION
           ===================================================================== */}
        {activeTab === "public" && (
          <div className="space-y-6">
            {/* For developers & judges: ERC-8021 attribution details */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-300">
                <MaxxAgentMark size={14} />
                Every MAXXAGENT transaction carries our Builder Code
              </div>
              <h2 className="text-xl font-bold text-white">
                ERC-8021 Transaction Attribution Engine
              </h2>
              <p className="text-xs text-slate-300 leading-relaxed">
                Swaps, approvals and index publications sent from MAXXAGENT end with an{" "}
                <strong>ERC-8021</strong> <code className="text-emerald-300">dataSuffix</code> so the
                activity is attributed to this app. The suffix is ignored by contracts and costs a few
                gas units.
              </p>

              <div className="space-y-3">
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                  MAXXAGENT Builder Code (NEXT_PUBLIC_BASE_BUILDER_CODE)
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 rounded-xl border border-slate-700 bg-[#050811] px-4 py-2.5 font-mono text-sm text-emerald-400">
                    {builderCode}
                  </div>
                  <button
                    onClick={() =>
                      copyToClipboard(attributionInfo.dataSuffix, "builder-suffix")
                    }
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition cursor-pointer"
                  >
                    <Copy className="h-4 w-4" />
                    {copiedKey === "builder-suffix" ? "Copied Suffix!" : "Copy dataSuffix"}
                  </button>
                </div>
              </div>

              {/* Byte-level Breakdown of ERC-8021 Suffix */}
              <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-3 font-mono text-xs">
                <div className="text-slate-400 font-sans text-xs font-semibold">
                  Live ERC-8021 Backward-Parsed Calldata Suffix Breakdown (
                  {attributionInfo.byteLength} bytes):
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-2.5">
                    <div className="text-[10px] text-blue-300">1. ASCII Builder Code</div>
                    <div className="text-white font-bold mt-1">
                      &quot;{attributionInfo.codes.join(",")}&quot;
                    </div>
                  </div>
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-2.5">
                    <div className="text-[10px] text-purple-300">2. Length + Schema ID</div>
                    <div className="text-white font-bold mt-1">
                      Len: {attributionInfo.codes.join(",").length}B | Schema: 0x00
                    </div>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5">
                    <div className="text-[10px] text-emerald-300">3. 16-Byte ERC-8021 Marker</div>
                    <div className="text-emerald-300 font-bold mt-1 truncate">
                      0x8021802180218021...
                    </div>
                  </div>
                </div>
                <div className="pt-2 border-t border-slate-800 text-[11px] text-emerald-300 break-all">
                  Full dataSuffix: {attributionInfo.dataSuffix}
                </div>
              </div>

              {/* How to verify attribution (no "check-in" transactions: only real actions are sent) */}
              <div className="rounded-xl border border-[#4C6FFF]/40 bg-[#4C6FFF]/10 p-4 space-y-2 text-[11px] text-slate-300">
                <div className="text-xs font-bold text-white">How to verify a MAXXAGENT transaction</div>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Buy a basket or publish an index (see the activity log below).</li>
                  <li>Open the transaction on BaseScan → Input Data: it ends with <code className="text-emerald-300">80218021…8021</code>.</li>
                  <li>
                    Or paste the hash into{" "}
                    <a href="https://builder-code-checker.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">
                      builder-code-checker
                    </a>
                    .
                  </li>
                </ol>
              </div>
            </div>

            {/* Right Column: Verifier & Code Snippet */}
            <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                <Terminal className="h-4 w-4" />
                ERC-8021 Calldata Decoder & Verification
              </div>
              <div className="rounded-xl border border-slate-800 bg-[#050811] p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Verification Status:</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {sampleDecoded.isValid ? "VALID ERC-8021 SUFFIX" : "INVALID"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Decoded Builder Code(s):</span>
                  <span className="font-mono font-bold text-white">
                    {sampleDecoded.codes.join(", ")}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Registry Schema ID:</span>
                  <span className="font-mono text-cyan-300">
                    Schema {sampleDecoded.schemaId}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">
                  How it is attached (see{" "}
                  <code className="text-cyan-300">src/lib/builderCode.ts</code>):
                </div>
                <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-[#050811] p-3.5 font-mono text-[11px] text-slate-300 leading-relaxed">
{`import { Attribution } from "ox/erc8021";

const dataSuffix = Attribution.toDataSuffix({ codes: ["${builderCode}"] });

// viem >= 2.45: every write from this client is attributed
const walletClient = createWalletClient({
  chain: base,
  transport: custom(window.ethereum),
  dataSuffix,
});`}
                </pre>
              </div>
            </div>

            </div>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Left: Build in Public X Post Generator */}
              <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-300">
                    <Flame className="h-3.5 w-3.5" />
                    Build in public
                  </div>
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-300">
                    <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                    Tags @buildonbase
                  </span>
                </div>

                <h2 className="text-xl font-bold text-white">
                  Progress post generator
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  25% of the judging criteria is{" "}
                  <strong>
                    &quot;Build in public: dated progress posts and community growth&quot;
                  </strong>{" "}
                  . Write what you actually shipped today — the post adds live onchain numbers.
                </p>

                {/* 4-Week Scheduled Build-in-Public Calendar Presets (Saved from JADWAL_POSTING_X.md) */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Milestone templates (only post what you really shipped)
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    {[
                      { dateLabel: "Day 1", day: 1, milestone: "Shipped live Chainlink NAV vs DEX price tracking for all 10 Coinbase tokenized stocks on Base" },
                      { dateLabel: "Day 2", day: 2, milestone: "Hardened for the official rules: no synthetic data, US geo-block, non-custodial only" },
                      { dateLabel: "Day 3", day: 3, milestone: "Shipped in-app basket buying: one wallet confirmation swaps USDC into each stock" },
                      { dateLabel: "Day 4", day: 4, milestone: "Real price history: Chainlink rounds + DEX candles, replacing placeholder charts" },
                      { dateLabel: "Day 5", day: 5, milestone: "Deployed StockMaxxIndexRegistry: publish an index onchain, anyone can buy it" },
                      { dateLabel: "First buy", day: 6, milestone: "First real basket bought through MAXXAGENT on Base mainnet (tx in thread)" },
                      { dateLabel: "Weekend", day: 7, milestone: "Weekend report: DEX vs Chainlink NAV gaps across all 10 tokenized stocks" },
                      { dateLabel: "Users", day: 8, milestone: "Weekly numbers: wallets, baskets bought and volume attributed via Builder Code" },
                    ].map((sched) => (
                      <button
                        key={sched.day}
                        onClick={() => {
                          setDayNumber(sched.day);
                          setMilestoneTitle(sched.milestone);
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left text-[11px] font-mono transition cursor-pointer ${
                          dayNumber === sched.day
                            ? "border-[#4C6FFF] bg-[#4C6FFF]/20 text-white font-bold"
                            : "border-slate-800 bg-[#050811] text-slate-300 hover:border-slate-700 hover:text-white"
                        }`}
                      >
                        {sched.dateLabel}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Build Day #
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={dayNumber}
                      onChange={(e) => setDayNumber(Number(e.target.value) || 1)}
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 font-mono text-xs text-white"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
                      Today&apos;s Shipped Milestone
                    </label>
                    <input
                      type="text"
                      value={milestoneTitle}
                      onChange={(e) => setMilestoneTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-700 bg-[#050811] px-3 py-2 text-xs text-white"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Generated X Post (Live Onchain Telemetry Embedded):</span>
                    <button
                      onClick={() => copyToClipboard(buildInPublicPost, "x-post")}
                      className="text-cyan-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Copy className="h-3 w-3" />
                      {copiedKey === "x-post" ? "Copied Post!" : "Copy Text"}
                    </button>
                  </div>
                  <pre className="rounded-xl border border-slate-800 bg-[#050811] p-4 font-sans text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {buildInPublicPost}
                  </pre>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href={`https://x.com/intent/tweet?text=${encodeURIComponent(buildInPublicPost)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-[#4C6FFF] px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-[#4C6FFF]/30 hover:bg-[#3D5BEA] transition"
                  >
                    <img src="/logos/brands/x.svg" alt="X" className="h-3.5 w-3.5" />
                    Post Progress Update on X (@buildonbase)
                  </a>
                  <a
                    href="https://docs.google.com/forms/d/1zotYvkeAtDjR2MKk3qNxyNIAfJ_IPQtzTtjNhOAF8js/viewform"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-700 transition"
                  >
                    <img
                      src="/logos/partners/base.svg"
                      alt="Base"
                      className="h-4 w-4 rounded-xs"
                    />
                    Open Official Base Submission Form
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              {/* Right: Official Submission Checklist & Loom Script */}
              <div className="lg:col-span-5 space-y-5">
                <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <img
                      src="/logos/partners/base.svg"
                      alt="Base"
                      className="h-5 w-5 rounded-xs"
                    />
                    <h3 className="text-base font-bold text-white">
                      Official Base Stocks Maxxing Submission Checklist
                    </h3>
                  </div>
                  <ul className="space-y-2.5 text-xs text-slate-300">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Nov 5 – Nov 13, 2026:</strong> Apply via the form and join the partner
                        Telegram groups (office hours are announced in each partner brief).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Configure Builder Code:</strong> Copy your Builder Code from{" "}
                        <code className="text-cyan-300">dashboard.base.org</code> into{" "}
                        <code className="text-emerald-300">.env.local</code> (
                        <code className="text-emerald-300">NEXT_PUBLIC_BASE_BUILDER_CODE</code>).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Record a 2-minute video demo:</strong> live market data, the agent
                        proposal, a real basket purchase, and the Builder Code on BaseScan.
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>
                        <strong>Before Dec 5, 2026 (11:59 PM UTC):</strong> Post Loom demo
                        publicly on X tagging <code className="text-blue-400">@buildonbase</code>{" "}
                        and submit the official form.
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-3">
                  <h3 className="text-sm font-bold text-white">
                    2-minute demo script
                  </h3>
                  <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300 leading-relaxed">
                    <li>
                      <strong>0:00–0:25 — Market:</strong> 10 Coinbase tokenized stocks live on Base,
                      Chainlink NAV (24/5) vs DEX price (24/7) on the real chart.
                    </li>
                    <li>
                      <strong>0:25–0:55 — Agent:</strong> type a mandate, show the proposed weights, the
                      live basket snapshot and the &quot;not financial advice&quot; framing.
                    </li>
                    <li>
                      <strong>0:55–1:30 — Buy:</strong> buy a small basket with USDC in one wallet
                      confirmation; show the stocks arriving in your own wallet.
                    </li>
                    <li>
                      <strong>1:30–2:00 — Proof:</strong> open the tx on BaseScan and point to the ERC-8021
                      suffix; show a published index in the registry.
                    </li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Directory of Stocks Maxxing Season partners (informational; no affiliation implied) */}
            <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-6 space-y-4">
              <div>
                <h3 className="text-base font-bold text-white">
                  Stocks Maxxing Season Partners & Support Channels
                </h3>
                <p className="text-xs text-slate-400">
                  Partners of the Base Stocks Maxxing Season, listed for reference only. MAXXAGENT is
                  an independent builder project and is not affiliated with, endorsed by, or
                  sponsored by any of them. Prize details are set by each partner — see their brief.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {STOCKS_MAXXING_PARTNERS.map((partner) => (
                  <div
                    key={partner.id}
                    className="rounded-xl border border-slate-800 bg-[#070b14] p-4 flex flex-col justify-between gap-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <img
                          src={partner.logoUrl}
                          alt={partner.name}
                          className="h-9 w-9 rounded-lg border border-slate-800 bg-slate-900 p-1 object-contain"
                        />
                        <div>
                          <div className="text-sm font-bold text-white">{partner.name}</div>
                          <div className="font-mono text-[11px] text-cyan-400">
                            {partner.handle}
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-relaxed">{partner.role}</p>
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                      <a
                        href={partner.notionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline inline-flex items-center gap-1"
                      >
                        Partner Brief <ExternalLink className="h-3 w-3" />
                      </a>
                      {partner.telegramUrl && (
                        <a
                          href={partner.telegramUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-slate-300 hover:text-white underline"
                        >
                          Telegram Group
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
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

      {/* Purchase status toast (visible from any tab) */}
      {(basketPending || basketError || basketResult) && activeTab !== "agent" && (
        <div className="fixed bottom-24 md:bottom-4 left-3 right-3 sm:left-auto sm:right-4 sm:w-96 z-50 rounded-2xl border border-slate-700 bg-[#0b1120]/95 p-4 text-xs shadow-2xl backdrop-blur space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="font-bold text-white">
              {basketPending ? basketStatus || "Working…" : basketError ? "Order not completed" : basketResult?.failed?.length ? "Partly completed" : basketResult?.side === "sell" ? "Sale confirmed" : "Purchase confirmed"}
            </div>
            {!basketPending && (
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
            )}
          </div>
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
      <footer className="border-t border-slate-800/80 bg-[#070b14] px-4 py-6 mt-12">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-[11px] text-slate-500">
          <div className="max-w-3xl space-y-1.5">
            <div className="flex items-center gap-2.5 text-slate-300 font-medium">
              <MaxxAgentMark size={20} />
              <span>
                MAXXAGENT — an independent project built for the Base Builder Quest: Stocks Maxxing
                Season (Nov 5 – Dec 5, 2026).
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
        aria-label="Sections"
      >
        <div className="grid grid-cols-4">
          {(
            [
              { id: "terminal", label: "Market", icon: TrendingUp },
              { id: "agent", label: "Agent", icon: Bot },
              { id: "indexes", label: "Indexes", icon: Layers },
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
                  active ? "text-white" : "text-slate-500"
                }`}
                aria-current={active ? "page" : undefined}
              >
                <span className={`rounded-xl px-3 py-1 ${active ? "bg-[#4C6FFF]/25" : ""}`}>
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
