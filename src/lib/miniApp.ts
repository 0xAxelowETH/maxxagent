/**
 * Mini app host detection (Farcaster Mini Apps; any client that implements the spec).
 * The SDK is loaded lazily so the normal website never pays for it.
 */
export async function detectMiniApp(): Promise<{ provider: unknown } | null> {
  if (typeof window === "undefined") return null;
  // Mini apps run in an iframe (web) or a native WebView; a top-level normal tab can't be one
  const framed = window.self !== window.top || "ReactNativeWebView" in window;
  if (!framed) return null;
  try {
    const { sdk } = await import("@farcaster/miniapp-sdk");
    if (!(await sdk.isInMiniApp())) return null;
    // Hide the host's splash screen; without this the user sees an endless loader
    await sdk.actions.ready().catch(() => {});
    const provider = await sdk.wallet.getEthereumProvider().catch(() => undefined);
    return provider ? { provider } : null;
  } catch {
    return null;
  }
}
