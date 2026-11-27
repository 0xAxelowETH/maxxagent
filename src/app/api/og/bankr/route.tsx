import { bankrCard } from "@/lib/og/bankrCard";

/** Share card for /bankr (the Bankr skill guide), 1200x630. Static content, pre-rendered at deploy. */
export const runtime = "nodejs";
export const dynamic = "force-static";

export function GET() {
  return bankrCard(630);
}
