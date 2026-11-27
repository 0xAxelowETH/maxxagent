import { bankrCard } from "@/lib/og/bankrCard";

/** 3:2 version (1200x800) of the /bankr card, for the Farcaster / Base App mini app embed. Pre-rendered. */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return bankrCard(800);
}
