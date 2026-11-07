"use client";

import { useEffect } from "react";

/**
 * Inside a mini app host, every page must tell the host it is ready, or the splash screen never closes
 * (deep links such as /stock/NVDAc or /faq open without going through the home page). No-op elsewhere.
 */
export function MiniAppReady() {
  useEffect(() => {
    const framed = window.self !== window.top || "ReactNativeWebView" in window;
    if (!framed) return;
    import("@farcaster/miniapp-sdk")
      .then(async ({ sdk }) => {
        if (await sdk.isInMiniApp()) await sdk.actions.ready();
      })
      .catch(() => {});
  }, []);
  return null;
}
