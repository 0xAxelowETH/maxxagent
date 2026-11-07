import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live onchain stats — MAXXAGENT",
  description: "Trades, volume and unique wallets for MAXXAGENT on Base, computed directly from onchain data.",
};

export default function StatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
