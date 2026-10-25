/**
 * Call insights (ADMIN_V2): anonymised counts by call reason, across all businesses and per business. Pure, no I/O.
 * Inputs are counts-only rows: no caller number, name, area or free text ever reaches this module.
 * Privacy floor: any count under FLOOR shows as "<10"; a business under BREAKDOWN_MIN calls gets no breakdown.
 */

export const FLOOR = 10;
export const BREAKDOWN_MIN = 20;
/** Missed demand: at least this many price or buying questions missed in 7 days... */
export const MISSED_MIN = FLOOR;
/** ...and at least this share of them. */
export const MISSED_SHARE = 0.3;

export type FactRow = {
  tenantId: string;
  intent: string | null;
  outcome: string | null;
  /** call_facts.unanswered_question is not null. The text itself is never loaded into this shape. */
  unanswered: boolean;
  createdAt: string;
};

export type GroupId = "price" | "buying" | "booking" | "complaint" | "after_sale" | "info" | "urgent" | "noise" | "other";

export const GROUPS: { id: GroupId; label: string; intents: string[] }[] = [
  { id: "price", label: "Price questions", intents: ["price_check"] },
  { id: "buying", label: "Buying questions", intents: ["product_info", "availability", "quote_request", "order_place"] },
  { id: "booking", label: "Booking requests", intents: ["book_visit"] },
  { id: "complaint", label: "Complaints", intents: ["complaint"] },
  { id: "after_sale", label: "Orders and after-sale", intents: ["order_status", "hold_or_pickup", "delivery_question", "payment_question", "return_refund", "warranty"] },
  { id: "info", label: "Hours, directions, general", intents: ["hours", "directions", "general_enquiry"] },
  { id: "urgent", label: "Urgent or asked for a person", intents: ["emergency", "human_request"] },
  { id: "noise", label: "Wrong number or spam", intents: ["wrong_number", "spam"] },
  { id: "other", label: "Other or not recorded", intents: ["other"] },
];

const INTENT_GROUP = new Map<string, GroupId>(GROUPS.flatMap((g) => g.intents.map((i) => [i, g.id] as [string, GroupId])));

export function groupOf(intent: string | null): GroupId {
  return (intent && INTENT_GROUP.get(intent)) || "other";
}

export const OUTCOMES: { id: string; label: string }[] = [
  { id: "sale_or_order", label: "Sale or order" },
  { id: "booking", label: "Booked" },
  { id: "hold", label: "Held for pickup" },
  { id: "callback", label: "Callback promised" },
  { id: "info_only", label: "Information only" },
  { id: "transferred", label: "Transferred" },
  { id: "lost", label: "Lost" },
  { id: "abandoned", label: "Caller hung up" },
];

/** Price or buying question that went unanswered, was lost, or ended with a callback promised. */
export function isMissedDemand(r: FactRow): boolean {
  const g = groupOf(r.intent);
  if (g !== "price" && g !== "buying") return false;
  return r.unanswered || r.outcome === "lost" || r.outcome === "callback";
}

export function isDemand(r: FactRow): boolean {
  const g = groupOf(r.intent);
  return g === "price" || g === "buying";
}

/** A count under the floor is never shown as a number. */
export function shown(n: number): string {
  return n < FLOOR ? `<${FLOOR}` : n.toLocaleString("en-KE");
}

/** Share is only shown when both the part and the whole clear the floor. */
export function shownShare(part: number, whole: number): string {
  if (part < FLOOR || whole < FLOOR) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

export type GroupCount = { id: GroupId; label: string; calls: number; missed: number };

export function groupCounts(rows: FactRow[]): GroupCount[] {
  const out = new Map<GroupId, GroupCount>(GROUPS.map((g) => [g.id, { id: g.id, label: g.label, calls: 0, missed: 0 }]));
  for (const r of rows) {
    const g = out.get(groupOf(r.intent))!;
    g.calls += 1;
    if (r.unanswered || r.outcome === "lost" || r.outcome === "callback") g.missed += 1;
  }
  return [...out.values()];
}

export function outcomeCounts(rows: FactRow[]): { id: string; label: string; calls: number }[] {
  return [
    ...OUTCOMES.map((o) => ({ ...o, calls: rows.filter((r) => r.outcome === o.id).length })),
    { id: "none", label: "Not recorded", calls: rows.filter((r) => !r.outcome || !OUTCOMES.some((o) => o.id === r.outcome)).length },
  ];
}

export type BusinessInsight = {
  tenantId: string;
  name: string;
  calls: number;
  /** False under BREAKDOWN_MIN: list the business, but no breakdown. */
  breakdown: boolean;
  topGroup: string | null;
  demand: number;
  missed: number;
};

export function businessInsights(rows: FactRow[], names: Map<string, string>): BusinessInsight[] {
  const by = new Map<string, FactRow[]>();
  for (const r of rows) by.set(r.tenantId, [...(by.get(r.tenantId) || []), r]);
  return [...by.entries()]
    .map(([tenantId, rs]) => {
      const breakdown = rs.length >= BREAKDOWN_MIN;
      const top = breakdown ? groupCounts(rs).filter((g) => g.id !== "other" && g.id !== "noise").toSorted((a, b) => b.calls - a.calls)[0] : null;
      return {
        tenantId,
        name: names.get(tenantId) || "Business",
        calls: rs.length,
        breakdown,
        topGroup: top && top.calls >= FLOOR ? top.label : null,
        demand: rs.filter(isDemand).length,
        missed: rs.filter(isMissedDemand).length,
      };
    })
    .toSorted((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

export type MissedDemand = { tenantId: string; missed: number; demand: number; price: number };

/** Missed demand over the last 7 days for each business that clears MISSED_MIN and MISSED_SHARE. */
export function missedDemand(rows: FactRow[], now: Date): MissedDemand[] {
  const since = now.getTime() - 7 * 86400_000;
  const by = new Map<string, MissedDemand>();
  for (const r of rows) {
    if (Date.parse(r.createdAt) < since || !isDemand(r)) continue;
    const m = by.get(r.tenantId) || { tenantId: r.tenantId, missed: 0, demand: 0, price: 0 };
    m.demand += 1;
    if (isMissedDemand(r)) {
      m.missed += 1;
      if (groupOf(r.intent) === "price") m.price += 1;
    }
    by.set(r.tenantId, m);
  }
  return [...by.values()].filter((m) => m.missed >= MISSED_MIN && m.missed / m.demand >= MISSED_SHARE);
}

export const INSIGHT_RANGES = [7, 30, 90] as const;
export function parseRange(raw: unknown): (typeof INSIGHT_RANGES)[number] {
  const n = Number(raw);
  return (INSIGHT_RANGES as readonly number[]).includes(n) ? (n as 7 | 30 | 90) : 30;
}

/** weeks: 7-day blocks back from now, newest first; `ending` is the block's last instant. */
export type WeekCount = { ending: string; calls: number; missed: number };
export type BusinessDetail = { groups: GroupCount[]; outcomes: { id: string; label: string; calls: number }[]; weeks: WeekCount[] };

export function weekCounts(rows: FactRow[], days: number, nowMs: number): WeekCount[] {
  const n = Math.ceil(days / 7);
  const out = Array.from({ length: n }, (_, k) => ({ ending: new Date(nowMs - k * 7 * 86400_000).toISOString(), calls: 0, missed: 0 }));
  for (const r of rows) {
    const k = Math.floor((nowMs - Date.parse(r.createdAt)) / (7 * 86400_000));
    if (k < 0 || k >= n) continue;
    out[k].calls += 1;
    if (isMissedDemand(r)) out[k].missed += 1;
  }
  return out;
}
export type InsightsData = {
  days: 7 | 30 | 90;
  calls: number;
  demand: number;
  missed: number;
  groups: GroupCount[];
  outcomes: { id: string; label: string; calls: number }[];
  businesses: BusinessInsight[];
  /** Only for businesses at or over BREAKDOWN_MIN. */
  detail: Record<string, BusinessDetail>;
};

/** Everything the page needs, aggregated server-side so rows never reach the browser. */
export function buildInsights(rows: FactRow[], names: Map<string, string>, days: 7 | 30 | 90, nowMs = Date.now()): InsightsData {
  const businesses = businessInsights(rows, names);
  const detail: Record<string, BusinessDetail> = {};
  for (const b of businesses) {
    if (!b.breakdown) continue;
    const rs = rows.filter((r) => r.tenantId === b.tenantId);
    detail[b.tenantId] = { groups: groupCounts(rs), outcomes: outcomeCounts(rs), weeks: weekCounts(rs, days, nowMs) };
  }
  return {
    days,
    calls: rows.length,
    demand: rows.filter(isDemand).length,
    missed: rows.filter(isMissedDemand).length,
    groups: groupCounts(rows),
    outcomes: outcomeCounts(rows),
    businesses,
    detail,
  };
}
