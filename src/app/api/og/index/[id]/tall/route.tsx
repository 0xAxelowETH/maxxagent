import { notFound } from "next/navigation";
import { indexCard, indexStaticParams } from "@/lib/og/indexCard";

/** 3:2 version (1200x800) of /api/og/index/<id>, for the Farcaster / Base App mini app embed. Pre-rendered (ISR). */
export const runtime = "nodejs";
export const revalidate = 3600;

export const generateStaticParams = indexStaticParams;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const res = await indexCard((await params).id, 800);
  if (!res) notFound();
  return res;
}
