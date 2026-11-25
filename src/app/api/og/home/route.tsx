import { homeCard } from "@/lib/og/homeCard";

/**
 * Site-wide share card, 1200x630 (see src/lib/og/homeCard.tsx).
 * Pre-rendered and refreshed in the background every hour (ISR): link-preview crawlers give up after a
 * few seconds, so they must never wait for a render.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export function GET() {
  return homeCard(630);
}
