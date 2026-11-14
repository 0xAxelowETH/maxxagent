/**
 * Weight helpers for baskets (integer basis points that sum to exactly 10,000).
 * Pure and dependency-free (unit-tested by scripts/test-agent.mjs).
 */

/**
 * Rounds weights to integer bps summing to exactly 10,000 without any going over capBps.
 * Tries tidy 50-bps steps first and falls back to 1-bps steps when the cap is too tight for them.
 * Returns null only when the cap makes 10,000 impossible (n * capBps < 10,000).
 */
export function roundWeightsBps(weights: number[], capBps = 10000): number[] | null {
  const cap = Math.floor(capBps);
  if (weights.length === 0) return [];
  if (weights.length * cap < 10000) return null;
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0) || 1;
  const exact = weights.map((w) => (Math.max(0, w) / total) * 10000);
  for (const step of [50, 1]) {
    const out = exact.map((w) => Math.min(cap - (cap % step), Math.floor(w / step) * step));
    let rest = 10000 - out.reduce((a, b) => a + b, 0);
    // Hand out the remainder to the largest fractional parts first, never past the cap
    const order = exact.map((w, i) => ({ i, frac: w - out[i] })).sort((a, b) => b.frac - a.frac);
    let progress = true;
    while (rest >= step && progress) {
      progress = false;
      for (const { i } of order) {
        if (rest < step) break;
        if (out[i] + step <= cap) {
          out[i] += step;
          rest -= step;
          progress = true;
        }
      }
    }
    if (rest === 0) return out;
  }
  return null;
}

/**
 * Caps every weight at capBps and gives the excess to the others in proportion to their weight
 * (water-filling), then rounds. Weights under the cap keep their order. Null when the cap is impossible.
 */
export function capWeightsBps(weights: number[], capBps: number): number[] | null {
  const n = weights.length;
  if (n === 0) return [];
  if (n * Math.floor(capBps) < 10000) return null;
  const total = weights.reduce((a, w) => a + Math.max(0, w), 0) || 1;
  let w = weights.map((x) => (Math.max(0, x) / total) * 10000);
  const fixed = new Array(n).fill(false);
  for (let iter = 0; iter < n; iter++) {
    const over = w.map((x, i) => !fixed[i] && x > capBps);
    if (!over.some(Boolean)) break;
    let excess = 0;
    w = w.map((x, i) => {
      if (!over[i]) return x;
      excess += x - capBps;
      fixed[i] = true;
      return capBps;
    });
    const freeTotal = w.reduce((a, x, i) => (fixed[i] ? a : a + x), 0);
    const freeCount = fixed.filter((f) => !f).length;
    if (freeCount === 0) break;
    w = w.map((x, i) => (fixed[i] ? x : x + (freeTotal > 0 ? (excess * x) / freeTotal : excess / freeCount)));
  }
  return roundWeightsBps(w, capBps);
}
