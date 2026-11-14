import type { Metadata } from "next";
import HomeClient from "./HomeClient";
import { miniappEmbedTags } from "@/lib/miniappEmbed";
import { basketImagePath, cleanIndexName, parseBasketParam } from "@/lib/shareBasket";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://maxxagent.xyz").replace(/\/$/, "");

type Search = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * A shared basket link (/?basket=NVDAc-40,MSFTc-30&name=…) previews as a card of that basket on X,
 * Farcaster and chat apps. Without a basket the site-wide metadata from the layout applies.
 */
export async function generateMetadata({ searchParams }: { searchParams: Search }): Promise<Metadata> {
  const q = await searchParams;
  const weights = parseBasketParam(first(q.basket));
  if (!weights) return {};
  const name = cleanIndexName(first(q.name), 48) || "Custom stock index";
  const legs = Object.entries(weights)
    .sort((a, b) => b[1] - a[1])
    .map(([s, w]) => `${s} ${Number((w / 100).toFixed(1))}%`)
    .join(", ");
  const title = `${name} — tokenized stock index on Base`;
  const description = `${legs}. Buy the whole basket from your own wallet with USDC or ETH on MAXXAGENT. Not financial advice.`;
  const image = basketImagePath(weights, { name });
  return {
    title: `${title} — MAXXAGENT`,
    description,
    openGraph: { type: "website", siteName: "MAXXAGENT", title, description, images: [{ url: image, width: 1200, height: 630, alt: `${name}: ${legs}` }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    other: miniappEmbedTags({
      siteUrl: SITE,
      buttonTitle: "Buy this basket",
      imageUrl: `${SITE}${basketImagePath(weights, { name, tall: true })}`,
    }),
  };
}

export default function Page() {
  return <HomeClient />;
}
