import { notFound } from "next/navigation";
import { indexCard, indexStaticParams } from "@/lib/og/indexCard";

/**
 * Pre-rendered share card for an onchain index page: /api/og/index/4 (1200x630).
 * Built at deploy (new indexes on first request) and refreshed in the background every hour (ISR),
 * so link-preview crawlers get it instantly.
 */
export const runtime = "nodejs";
export const revalidate = 3600;

export const generateStaticParams = indexStaticParams;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const res = await indexCard((await params).id, 630);
  if (!res) notFound();
  return res;
}
