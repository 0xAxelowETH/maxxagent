import { homeCard } from "@/lib/og/homeCard";

/** 3:2 version (1200x800) of the site-wide card, for the Farcaster / Base App mini app embed. Pre-rendered (ISR). */
export const runtime = "nodejs";
export const revalidate = 3600;

export function GET() {
  return homeCard(800);
}
