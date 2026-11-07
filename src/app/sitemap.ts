import type { MetadataRoute } from "next";
import { BASE_TOKENIZED_STOCKS } from "@/lib/tokenizedStocks";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

export default function sitemap(): MetadataRoute.Sitemap {
  const stocks = BASE_TOKENIZED_STOCKS.map((s) => `/stock/${s.symbol}`);
  return ["", "/stats", "/faq", "/terms", ...stocks].map((path) => ({
    url: `${SITE_URL}${path}`,
    changeFrequency: path === "" || path.startsWith("/stock/") ? "daily" : "monthly",
    priority: path === "" ? 1 : 0.5,
  }));
}
