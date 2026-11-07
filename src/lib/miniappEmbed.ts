/**
 * Mini app embed tags (fc:miniapp + legacy fc:frame) so a shared link renders as a launch card.
 * Per the Farcaster Mini Apps spec, action.url is optional and defaults to the page URL.
 */
export function miniappEmbedTags(opts: { siteUrl: string; path?: string; buttonTitle?: string }): Record<string, string> {
  const base = opts.siteUrl.replace(/\/$/, "");
  const embed = (type: string) =>
    JSON.stringify({
      version: "1",
      imageUrl: `${base}/brand/miniapp-embed-1200x800.png`,
      button: {
        title: (opts.buttonTitle || "Build a stock index").slice(0, 32),
        action: {
          type,
          name: "MAXXAGENT",
          // No path: the client launches the shared page's own URL (query included, e.g. /?basket=…)
          ...(opts.path ? { url: `${base}${opts.path}` } : {}),
          splashImageUrl: `${base}/brand/miniapp-splash-200.png`,
          splashBackgroundColor: "#03060e",
        },
      },
    });
  return { "fc:miniapp": embed("launch_miniapp"), "fc:frame": embed("launch_frame") };
}
