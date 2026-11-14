/**
 * Company fundamentals from SEC EDGAR (public, free, no key): the latest annual revenue and net income
 * from each company's own 10-K, with the filing it came from. Used by the agent as sourced facts.
 *
 * Data: https://data.sec.gov/api/xbrl/companyconcept/CIK##########/us-gaap/<tag>.json
 * Server only. Cached for a day; any failure just means the fact is left out.
 */

/** B20 symbol -> SEC CIK (from sec.gov/files/company_tickers.json, checked 2026-11-14) */
export const SEC_CIK: Record<string, number> = {
  NVDAc: 1045810,
  AAPLc: 320193,
  TSLAc: 1318605,
  MSFTc: 789019,
  METAc: 1326801,
  GOOGLc: 1652044,
  AMZNc: 1018724,
  MSTRc: 1050446,
  SNDKc: 2023554,
  SPCXc: 1181412,
};

export interface SecFundamentals {
  /** last day of the fiscal year, YYYY-MM-DD */
  periodEnd: string;
  revenueUsd: number;
  /** vs the fiscal year before, in percent; null when the earlier year isn't reported */
  revenueGrowthPct: number | null;
  netIncomeUsd: number | null;
  form: string;
  filed: string;
  filingUrl: string;
}

const REVENUE_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"];
const DAY = 86_400_000;
const CACHE_MS = DAY;
// SEC asks automated clients to identify themselves; set SEC_USER_AGENT to a real contact in production
const USER_AGENT = process.env.SEC_USER_AGENT || "stock-index-research/1.0 (research@example.org)";

interface Fact { start?: string; end: string; val: number; accn: string; form: string; filed: string }

/** The tag's figures; [] when the company doesn't use the tag, null when SEC couldn't be reached */
async function concept(cik: number, tag: string, attempt = 0): Promise<Fact[] | null> {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${String(cik).padStart(10, "0")}/us-gaap/${tag}.json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      next: { revalidate: CACHE_MS / 1000 },
      signal: AbortSignal.timeout(8000),
    });
    // 404 = the company doesn't use this tag. Rate limits and server errors get one more try.
    if ((res.status === 429 || res.status >= 500) && attempt === 0) return concept(cik, tag, 1);
    if (res.status === 404) return [];
    if (!res.ok) return null;
    const data = (await res.json()) as { units?: { USD?: Fact[] } };
    return data.units?.USD ?? [];
  } catch {
    return attempt === 0 ? concept(cik, tag, 1) : null;
  }
}

/** Full-year figures from annual reports, one per fiscal year end (the latest filing wins) */
function annual(facts: Fact[]): Map<string, Fact> {
  const byEnd = new Map<string, Fact>();
  for (const f of facts) {
    if (!/^10-K/.test(f.form) || !f.start) continue;
    const days = (Date.parse(f.end) - Date.parse(f.start)) / DAY;
    if (days < 350 || days > 380) continue;
    const prev = byEnd.get(f.end);
    if (!prev || f.filed > prev.filed) byEnd.set(f.end, f);
  }
  return byEnd;
}

/** null = SEC has no annual revenue for the company (e.g. no 10-K yet); undefined = couldn't check now */
async function load(cik: number): Promise<SecFundamentals | null | undefined> {
  const results = await Promise.all([concept(cik, "NetIncomeLoss"), ...REVENUE_TAGS.map((t) => concept(cik, t))]);
  if (results.some((r) => r === null)) return undefined;
  const [netIncome, ...revenues] = results as Fact[][];
  // Companies switch revenue tags over the years: use whichever reports the most recent year
  let rev: Map<string, Fact> | null = null;
  let latestEnd = "";
  for (const r of revenues) {
    const m = annual(r);
    const end = [...m.keys()].sort().pop() ?? "";
    if (end > latestEnd) [rev, latestEnd] = [m, end];
  }
  if (!rev || !latestEnd) return null;
  const cur = rev.get(latestEnd)!;
  // The year before: an end date roughly one year earlier (fiscal years can end on different weekdays)
  const prior = [...rev.values()].find((f) => Math.abs(Date.parse(latestEnd) - Date.parse(f.end) - 365 * DAY) <= 10 * DAY);
  const ni = annual(netIncome).get(latestEnd);
  return {
    periodEnd: latestEnd,
    revenueUsd: cur.val,
    revenueGrowthPct: prior && prior.val > 0 ? ((cur.val - prior.val) / prior.val) * 100 : null,
    netIncomeUsd: ni ? ni.val : null,
    form: cur.form,
    filed: cur.filed,
    filingUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${cur.accn.replace(/-/g, "")}/`,
  };
}

const cache = new Map<string, { at: number; value: SecFundamentals | null }>();
let inflight: Promise<void> | null = null;

async function refresh(symbols: string[]) {
  // A few companies at a time: SEC allows at most 10 requests per second
  for (let i = 0; i < symbols.length; i += 3) {
    await Promise.all(
      symbols.slice(i, i + 3).map(async (s) => {
        const value = await load(SEC_CIK[s]);
        // A failed check keeps whatever was known before and is retried on the next request
        if (value !== undefined) cache.set(s, { at: Date.now(), value });
      })
    );
  }
}

/**
 * Fundamentals for the given B20 symbols: the figures, or null when SEC has no annual report for the
 * company. Waits at most `waitMs` for SEC; symbols not checked yet are left out of this answer and keep
 * loading for the next one.
 */
export async function getSecFundamentals(symbols: string[], waitMs = 4000): Promise<Record<string, SecFundamentals | null>> {
  const known = symbols.filter((s) => SEC_CIK[s]);
  const stale = known.filter((s) => {
    const c = cache.get(s);
    return !c || Date.now() - c.at > CACHE_MS;
  });
  if (stale.length && !inflight) inflight = refresh(stale).finally(() => (inflight = null));
  if (inflight) await Promise.race([inflight, new Promise((r) => setTimeout(r, waitMs))]);
  const out: Record<string, SecFundamentals | null> = {};
  for (const s of known) {
    const c = cache.get(s);
    if (c) out[s] = c.value;
  }
  return out;
}
