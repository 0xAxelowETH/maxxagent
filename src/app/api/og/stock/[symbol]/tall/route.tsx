import { notFound } from "next/navigation";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";
import { findStock, stockCard } from "@/lib/og/stockCard";

/** 3:2 version (1200x800) of /api/og/stock/<SYMBOL>, for the Farcaster / Base App mini app embed. Pre-rendered (ISR). */
export const runtime = "nodejs";
export const revalidate = 1800;
export const dynamicParams = false;

export function generateStaticParams() {
  return BASE_TOKENIZED_STOCKS.map((s) => ({ symbol: s.symbol }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  if (!findStock(symbol)) notFound();
  return stockCard(symbol, 20000, 800);
}
