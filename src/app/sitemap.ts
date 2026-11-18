import type { MetadataRoute } from "next";
import { HIDDEN, indexCount, readIndexes, registryDeployed, type PublishedIndex } from "@/lib/indexRegistry";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

export const revalidate = 3600;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");

async function publishedIndexPaths(): Promise<string[]> {
  if (!registryDeployed()) return [];
  try {
    const total = Math.min(200, await Promise.race([indexCount(), new Promise<number>((r) => setTimeout(() => r(0), 4000))]));
    if (total <= 0) return [];
    const ids = Array.from({ length: total }, (_, i) => i).filter((id) => !HIDDEN.has(id));
    const indexes = await Promise.race([readIndexes(ids), new Promise<PublishedIndex[]>((r) => setTimeout(() => r([]), 4000))]);
    return indexes.map((ix) => `/index/${ix.id}`);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const stocks = BASE_TOKENIZED_STOCKS.map((s) => `/stock/${s.symbol}`);
  const indexes = await publishedIndexPaths();
  return ["", "/stats", "/verify", "/faq", "/terms", ...stocks, ...indexes].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" || path.startsWith("/stock/") || path.startsWith("/index/") ? "daily" : "monthly",
    priority: path === "" ? 1 : path.startsWith("/index/") ? 0.6 : 0.5,
  }));
}
