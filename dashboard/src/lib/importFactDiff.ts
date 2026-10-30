import type { FaqEntry, TenantRow } from "./supabase";
import type { IngestDraft } from "./ingest/extract";
import { formatHoursForCompiler } from "./hoursSchedule";

/**
 * Import review, one row per fact (30 Oct, DESK_IMPORT_FACTS): what calls use now next to what the import found, so
 * the owner ticks a change knowing what it replaces. Pure: nothing is read or saved here.
 */
export type FactDiff = { now: string; next: string; same: boolean };
export type FaqDiff = "new" | "same" | "changes";

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9\u00C0-\u024F]+/g, " ").trim();
const diff = (now: string, next: string): FactDiff => ({ now: now.trim() || "Not set", next: next.trim(), same: norm(now) === norm(next) });

type Tenant = Pick<TenantRow, "business_hours" | "hours_schedule" | "business_locations" | "business_policies" | "faqs">;

export function hoursDiff(t: Tenant, d: Pick<IngestDraft, "hoursNotes" | "hoursSchedule">): FactDiff | null {
  const next = d.hoursNotes?.trim() || formatHoursForCompiler(d.hoursSchedule ?? null).trim();
  if (!next) return null;
  const now = String(t.business_hours || "").trim() || formatHoursForCompiler((t.hours_schedule as never) ?? null).trim();
  return diff(now, next);
}

const locLine = (l: { label?: string; address?: string; landmark?: string }) => [l.label, l.address, l.landmark].filter(Boolean).join(" · ");

export function locationsDiff(t: Tenant, d: Pick<IngestDraft, "locations">): FactDiff | null {
  if (!d.locations?.length) return null;
  return diff((t.business_locations || []).map(locLine).join("; "), d.locations.map(locLine).join("; "));
}

const POLICY_LABEL: Record<string, string> = {
  returns: "Returns",
  delivery: "Delivery",
  payment: "Payment",
  deposit: "Deposit",
  cancellation: "Cancellation",
  warranty: "Warranty",
  other: "Other",
};

/** One row per policy the import found. */
export function policyDiffs(t: Tenant, d: Pick<IngestDraft, "policies">): { key: string; label: string; diff: FactDiff }[] {
  const now = (t.business_policies || {}) as Record<string, unknown>;
  return Object.entries((d.policies || {}) as Record<string, unknown>)
    .filter(([k, v]) => POLICY_LABEL[k] && String(v || "").trim())
    .map(([k, v]) => ({ key: k, label: POLICY_LABEL[k], diff: diff(String(now[k] || ""), String(v)) }));
}

/** Per imported FAQ: a new question, one already answered the same way, or one whose answer would change. */
export function faqDiffs(t: Tenant, d: Pick<IngestDraft, "faqs">): FaqDiff[] {
  const have = new Map((t.faqs || []).map((f: FaqEntry) => [norm(f.question), norm(f.answer)]));
  return (d.faqs || []).map((f) => {
    const a = have.get(norm(f.question));
    return a === undefined ? "new" : a === norm(f.answer) ? "same" : "changes";
  });
}

export const FAQ_DIFF_LINE: Record<FaqDiff, string> = {
  new: "New",
  same: "You already have this",
  changes: "Changes your answer",
};

/** "Now: … · Import: …" for a switch hint. */
export function diffHint(x: FactDiff): string {
  return x.same ? `Same as now: ${x.next}` : `Now: ${x.now}. Import: ${x.next}`;
}
