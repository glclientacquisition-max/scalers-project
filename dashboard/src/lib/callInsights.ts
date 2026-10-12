/**
 * Overview call insights from call_facts. Pure, so the same rules run in tests and on the page.
 * Honest by design: a section only shows a pattern once enough calls back it, and every number
 * links to the calls behind it.
 */
import taxonomy from "./taxonomy.json" with { type: "json" };

export type CallFactRow = {
  call_id: string;
  created_at: string;
  outcome: string | null;
  lost_reason: string | null;
  products_mentioned: unknown;
  price_objection: boolean | null;
  objection_price_ksh: number | null;
  unanswered_question: string | null;
  language: string | null;
  time_of_day: string | null;
  hour_eat: number | null;
  dow: number | null;
};

export type InsightCall = { callId: string; at: string; note: string | null };
export type InsightBar = { id: string; label: string; count: number; calls: InsightCall[]; group?: string };
export type InsightSection = {
  id: "lost" | "products" | "objections" | "unanswered" | "busiest" | "language";
  title: string;
  /** One line for the row. Null when the section is too thin to say anything. */
  summary: string | null;
  /** Calls that fed this section. */
  basis: number;
  /** What it takes to fill a thin section. */
  thin: string;
  bars: InsightBar[];
};
export type CallInsights = { days: number; calls: number; ready: boolean; sections: InsightSection[] };

/** Below this many reviewed calls the Overview says so instead of drawing charts. */
export const MIN_CALLS = 5;
/** A section needs this many contributing calls before it names a pattern. */
export const MIN_SECTION = 3;

const label = (list: Array<{ id: string; label: string }>, id: string) => list.find((x) => x.id === id)?.label ?? id;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function eatHour(row: CallFactRow): number | null {
  if (Number.isInteger(row.hour_eat)) return row.hour_eat as number;
  const t = Date.parse(row.created_at);
  return Number.isFinite(t) ? new Date(t + 3 * 3600_000).getUTCHours() : null;
}

function eatDow(row: CallFactRow): number | null {
  if (Number.isInteger(row.dow)) return row.dow as number;
  const t = Date.parse(row.created_at);
  return Number.isFinite(t) ? new Date(t + 3 * 3600_000).getUTCDay() : null;
}

export function hourLabel(h: number): string {
  const s = (x: number) => `${x % 12 === 0 ? 12 : x % 12}${x < 12 || x === 24 ? "am" : "pm"}`;
  return `${s(h)} to ${s(h + 1)}`;
}

function tally(rows: CallFactRow[], key: (r: CallFactRow) => Array<{ id: string; label: string; note?: string | null }>): InsightBar[] {
  const map = new Map<string, InsightBar>();
  for (const r of rows) {
    for (const k of key(r)) {
      const bar = map.get(k.id) ?? { id: k.id, label: k.label, count: 0, calls: [] };
      bar.count += 1;
      if (!bar.calls.some((c) => c.callId === r.call_id)) bar.calls.push({ callId: r.call_id, at: r.created_at, note: k.note ?? (productNames(r.products_mentioned).join(", ") || null) });
      map.set(k.id, bar);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function productNames(raw: unknown): string[] {
  const out = new Set<string>();
  for (const p of Array.isArray(raw) ? raw : []) {
    const name = String((p && typeof p === "object" ? (p as { name?: unknown }).name : p) ?? "").trim().replace(/\s+/g, " ");
    if (name) out.add(name.slice(0, 80));
  }
  return [...out];
}

const ksh = (n: number) => `KSh ${Math.round(n).toLocaleString("en-KE")}`;

export function buildCallInsights(input: CallFactRow[], days = 30): CallInsights {
  const rows = [...input].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const n = rows.length;

  const lostRows = rows.filter((r) => r.outcome === "lost" || r.lost_reason);
  const lost = tally(lostRows, (r) => [{ id: r.lost_reason || "other", label: label(taxonomy.lost_reasons, r.lost_reason || "other") }]);

  const products = tally(rows, (r) =>
    productNames(r.products_mentioned).map((name) => ({ id: name.toLowerCase(), label: name }))
  );
  const productCalls = rows.filter((r) => productNames(r.products_mentioned).length).length;

  const objRows = rows.filter((r) => r.price_objection === true);
  const objections = tally(objRows, (r) => {
    const names = productNames(r.products_mentioned);
    const note = Number(r.objection_price_ksh) > 0 ? `Hoped to pay ${ksh(Number(r.objection_price_ksh))}` : null;
    return names.length ? names.map((name) => ({ id: name.toLowerCase(), label: name, note })) : [{ id: "_none", label: "No item named", note }];
  });

  const unRows = rows.filter((r) => (r.unanswered_question || "").trim());
  const unanswered = tally(unRows, (r) => {
    const q = (r.unanswered_question || "").trim().replace(/\s+/g, " ");
    return [{ id: q.toLowerCase().replace(/[?.!\s]+$/, ""), label: q }];
  });

  const hours = tally(rows, (r) => {
    const h = eatHour(r);
    return h === null ? [] : [{ id: `h${String(h).padStart(2, "0")}`, label: hourLabel(h) }];
  });
  const dows = tally(rows, (r) => {
    const d = eatDow(r);
    return d === null ? [] : [{ id: `d${d}`, label: DAYS[d] }];
  });
  const parts = tally(rows, (r) => {
    const t = r.time_of_day || (() => { const h = eatHour(r); return h === null ? null : taxonomy.time_of_day.find((x) => h >= x.from && h < x.to)?.id ?? null; })();
    return t ? [{ id: t, label: label(taxonomy.time_of_day, t) }] : [];
  });

  const langRows = rows.filter((r) => r.language);
  const langs = tally(langRows, (r) => [{ id: r.language as string, label: label(taxonomy.languages, r.language as string) }]);

  const pct = (a: number, b: number) => `${Math.round((a / Math.max(1, b)) * 100)}%`;
  const enough = (basis: number) => n >= MIN_CALLS && basis >= MIN_SECTION;

  const sections: InsightSection[] = [
    {
      id: "lost",
      title: "Why sales were lost",
      basis: lostRows.length,
      thin: lostRows.length ? `${plural(lostRows.length, "lost sale")} so far. A reason shows from ${MIN_SECTION}.` : "No lost sales recorded yet.",
      summary: enough(lostRows.length) && lost[0] ? `${lost[0].label}: ${lost[0].count} of ${lostRows.length}` : null,
      bars: lost,
    },
    {
      id: "products",
      title: "Most asked about",
      basis: productCalls,
      thin: productCalls ? `${plural(productCalls, "call")} named an item so far.` : "No calls have named an item yet.",
      summary: enough(productCalls) && products[0] ? `${products[0].label}, in ${plural(products[0].count, "call")}` : null,
      bars: products.slice(0, 20),
    },
    {
      id: "objections",
      title: "Price pushback",
      basis: objRows.length,
      thin: objRows.length ? `${plural(objRows.length, "caller")} pushed back on price so far.` : "No caller has pushed back on price yet.",
      summary: enough(objRows.length) ? `${plural(objRows.length, "call")}, ${pct(objRows.length, n)} of calls` : null,
      bars: objections,
    },
    {
      id: "unanswered",
      title: "Questions we could not answer",
      basis: unRows.length,
      // A single unanswered question is already worth fixing, so this one never waits for a pattern.
      thin: "Your Business Assistant answered every question so far.",
      summary: unRows.length ? `${plural(unanswered.length, "question")} to add to your FAQs` : null,
      bars: unanswered.slice(0, 30),
    },
    {
      id: "busiest",
      title: "Busiest times",
      basis: hours.reduce((s, b) => s + b.count, 0),
      thin: `Times show after ${MIN_CALLS} calls. ${plural(n, "call")} so far.`,
      summary: enough(n) && hours[0] ? `${hours[0].label}${dows[0] ? `, ${dows[0].label}s` : ""}` : null,
      bars: [
        ...parts.map((b) => ({ ...b, group: "Part of day" })),
        ...dows.map((d) => ({ ...d, id: `dow-${d.id}`, group: "Day" })),
        ...hours.slice(0, 5).map((h) => ({ ...h, id: `hour-${h.id}`, group: "Busiest hours" })),
      ],
    },
    {
      id: "language",
      title: "Languages callers use",
      basis: langRows.length,
      thin: langRows.length ? `${plural(langRows.length, "call")} with a language so far.` : "No language recorded yet.",
      summary: enough(langRows.length) ? langs.slice(0, 3).map((l) => `${l.label} ${pct(l.count, langRows.length)}`).join(", ") : null,
      bars: langs,
    },
  ];
  return { days, calls: n, ready: n >= MIN_CALLS, sections };
}
