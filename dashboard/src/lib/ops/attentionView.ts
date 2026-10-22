/**
 * Needs attention (ADMIN_V2): pure shaping. No data access, no `@/` imports, so tests load it directly.
 * Four reasons, each from a real record: an open invoice past due, a business waiting for a number,
 * package minutes at or above NEAR_LIMIT of the period, and call quality marked dropping by the trace rollup.
 */

export const NEAR_LIMIT = 0.8;
const DAY_MS = 24 * 60 * 60 * 1000;

export type AttentionKind = "overdue" | "no-number" | "near-limit" | "quality";

export const ATTENTION_VIEWS: { id: "all" | AttentionKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "overdue", label: "Overdue" },
  { id: "no-number", label: "No number" },
  { id: "near-limit", label: "Near package limit" },
  { id: "quality", label: "Quality dropping" },
];

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  businessId: string;
  businessName: string;
  /** One line: what is wrong, with the number that makes it so. */
  detail: string;
  /** When the problem started (due date, sign-up). null when the record has no start. */
  since: string | null;
  /** Where to go to deal with it. */
  href: string;
  /** Sort weight inside a kind: bigger is worse. */
  weight: number;
  /** Extra facts for the pane. */
  facts: { label: string; value: string }[];
};

export type OverdueInput = { id: string; tenantId: string; number: string; owedCents: number; dueAt: string };
export type UsageInput = { tenantId: string; includedMinutes: number; usedSeconds: number; packageName: string | null };
export type BusinessInput = { id: string; name: string; status: string; createdAt: string };
export type QualityInput = { tenantId: string; score: number | null; reason: string };

const KIND_ORDER: AttentionKind[] = ["overdue", "no-number", "near-limit", "quality"];

export const KIND_LABEL: Record<AttentionKind, string> = {
  overdue: "Overdue",
  "no-number": "No number",
  "near-limit": "Near limit",
  quality: "Quality",
};

export function daysBetween(fromIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(fromIso).getTime()) / DAY_MS));
}

function ksh(cents: number): string {
  return `KSh ${(Math.round(cents) / 100).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function dayWord(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/** Share of the period's package minutes already used, or null when the package has none. */
export function usageShare(u: UsageInput): number | null {
  if (!(u.includedMinutes > 0)) return null;
  return Math.max(0, u.usedSeconds) / (u.includedMinutes * 60);
}

export function buildAttention(input: {
  businesses: BusinessInput[];
  overdue: OverdueInput[];
  usage: UsageInput[];
  quality: QualityInput[];
  now: Date;
}): AttentionItem[] {
  const { now } = input;
  const byId = new Map(input.businesses.map((b) => [b.id, b]));
  const live = (id: string) => {
    const b = byId.get(id);
    return b && b.status !== "archived" ? b : null;
  };
  const items: AttentionItem[] = [];

  for (const inv of input.overdue) {
    const b = live(inv.tenantId);
    if (!b || !(inv.owedCents > 0)) continue;
    const late = daysBetween(inv.dueAt, now);
    items.push({
      key: `overdue-${inv.id}`,
      kind: "overdue",
      businessId: b.id,
      businessName: b.name,
      detail: `${inv.number} · ${ksh(inv.owedCents)} owed · ${late ? `${dayWord(late)} late` : "due today"}`,
      since: inv.dueAt,
      href: `/admin/billing/invoices/${inv.id}`,
      weight: late,
      facts: [
        { label: "Invoice", value: inv.number },
        { label: "Owed", value: ksh(inv.owedCents) },
        { label: "Days late", value: String(late) },
      ],
    });
  }

  for (const b of input.businesses) {
    if (b.status !== "waiting") continue;
    const waited = daysBetween(b.createdAt, now);
    items.push({
      key: `no-number-${b.id}`,
      kind: "no-number",
      businessId: b.id,
      businessName: b.name,
      detail: `Signed up ${waited ? `${dayWord(waited)} ago` : "today"}, no number yet`,
      since: b.createdAt,
      href: `/admin/businesses/${b.id}`,
      weight: waited,
      facts: [{ label: "Waiting", value: dayWord(waited) }],
    });
  }

  for (const u of input.usage) {
    const b = live(u.tenantId);
    const share = usageShare(u);
    if (!b || b.status === "waiting" || share === null || share < NEAR_LIMIT) continue;
    const used = Math.floor(Math.max(0, u.usedSeconds) / 60);
    const pct = Math.round(share * 100);
    items.push({
      key: `near-limit-${b.id}`,
      kind: "near-limit",
      businessId: b.id,
      businessName: b.name,
      detail: `${used} of ${u.includedMinutes} min used · ${pct}%${share >= 1 ? " · over" : ""}`,
      since: null,
      href: `/admin/billing/${b.id}`,
      weight: share,
      facts: [
        { label: "Package", value: u.packageName || "No package" },
        { label: "Used", value: `${used} of ${u.includedMinutes} min` },
        { label: "Share", value: `${pct}%` },
      ],
    });
  }

  for (const q of input.quality) {
    const b = live(q.tenantId);
    if (!b) continue;
    items.push({
      key: `quality-${b.id}`,
      kind: "quality",
      businessId: b.id,
      businessName: b.name,
      detail: q.reason || "Call quality is dropping",
      since: null,
      href: `/admin/quality/${b.id}`,
      weight: q.score === null ? 0 : 100 - q.score,
      facts: [{ label: "Score", value: q.score === null ? "Not logged" : String(Math.round(q.score * 10) / 10) }],
    });
  }

  return items.toSorted(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.weight - a.weight || a.businessName.localeCompare(b.businessName),
  );
}

export function attentionCounts(items: AttentionItem[]): Record<"all" | AttentionKind, number> {
  const out = { all: items.length, overdue: 0, "no-number": 0, "near-limit": 0, quality: 0 };
  for (const i of items) out[i.kind] += 1;
  return out;
}
