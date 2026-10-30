import type { FaqEntry, TenantRow } from "./supabase";
import type { IngestDraft } from "./ingest/extract";
import { formatHoursForCompiler, formatHoursForOwner, parseHoursSchedule, type HoursSchedule } from "./hoursSchedule";
import { normalizePayments, paymentsSentence } from "./payments";
import { FACT_POLICY_KEYS, type FactCard } from "./factCards";
import { parseHoursText } from "./hoursText";
import { normalizeBusinessLocations } from "./businessLocations";
import { areaNode, matchAreaText, normalizeAreaPicks, type AreaPicks } from "./areaPicks";

export { FACT_POLICY_KEYS, factPolicyPatch, tickedFacts, type FactCard, type FactPolicyKey } from "./factCards";

/**
 * Add many, found facts (30 Oct): what calls use now next to what the paste, file, photo or website found, one card
 * per fact, so the owner ticks a change knowing what it replaces. Restored from the old Import review (PR 10) and
 * moved into the Add many sheet. Pure: nothing is read or saved here; each card saves through its own settings action.
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

// ---------- Add many: one review card per found fact ----------

export type FactTenant = Tenant;

/** Sources the owner did not write: an import, a starter pack, a guess or a call suggestion. */
const NOT_OWNER = new Set(["import", "seed", "inferred", "call_suggested", "pack", "starter"]);

export const FACT_CARDS_MAX_FAQS = 25;

/**
 * Cards for one found draft. Reads only hours, policies, payment, service areas and FAQs from the draft: never the
 * business name, its type, the greeting, the team or alert numbers (those stay on their own screens).
 * ownerPaths: tenant_field_meta paths whose source is owner. areas: the stored picks and whether the owner checked them.
 */
export function buildFactCards(input: {
  tenant: Tenant;
  draft: Pick<IngestDraft, "hoursSchedule" | "policies" | "faqs" | "locations"> & { hoursNotes?: string };
  ownerPaths?: ReadonlySet<string>;
  areas?: { picks: AreaPicks | null; confirmed: boolean } | null;
}): FactCard[] {
  const { tenant: t, draft: d } = input;
  const owner = input.ownerPaths ?? new Set<string>();
  const cards: FactCard[] = [];
  const policies = (t.business_policies || {}) as Record<string, unknown> & { provenance?: Record<string, { source?: string }> };
  const policyOwner = (key: string) => owner.has(`policies.${key}`) || policies.provenance?.[key]?.source === "owner";

  const hours = foundHours(d, t);
  if (hours) {
    const found = formatHoursForOwner(hours.schedule) || formatHoursForCompiler(hours.schedule);
    const nowSchedule = parseHoursSchedule((t.hours_schedule as never) ?? null);
    const now = (nowSchedule ? formatHoursForOwner(nowSchedule) : "") || String(t.business_hours || "").trim();
    const x = diff(now, found);
    if (!x.same) {
      const ownerSet = owner.has("hours.weekly_grid");
      cards.push({
        id: "hours",
        kind: "hours",
        label: "Opening hours",
        now: x.now,
        found: x.next,
        ownerSet,
        on: !ownerSet && !hours.unsure,
        note: hours.unsure ? hours.note || "Read from a sentence. Check it before you tick." : null,
        schedule: hours.schedule,
      });
    }
  }

  const addr = addressCard(t, d.locations, owner.has("locations.branches"));
  if (addr) cards.push(addr);

  const foundPolicies = (d.policies || {}) as Record<string, unknown>;
  for (const key of FACT_POLICY_KEYS) {
    const value = String(foundPolicies[key] || "").trim();
    if (!value) continue;
    const x = diff(String(policies[key] || ""), value);
    if (x.same) continue;
    const ownerSet = policyOwner(key);
    cards.push({ id: `policy:${key}`, kind: "policy", key, label: POLICY_LABEL[key], now: x.now, found: x.next, ownerSet, on: !ownerSet, value });
  }

  const payment = String(foundPolicies.payment || "").trim();
  if (payment) {
    const structured = normalizePayments(policies.payments);
    const nowPay = (structured ? paymentsSentence(structured) : "") || String(policies.payment || "");
    const x = diff(nowPay, payment);
    if (!x.same) {
      const ownerSet = policyOwner("payment") || owner.has("payments.methods") || !!structured;
      // Payment details are never preticked: a wrong till or paybill sends a caller's money elsewhere.
      cards.push({ id: "payment", kind: "payment", label: "How customers pay", now: x.now, found: x.next, ownerSet, on: false, value: payment });
    }
  }

  const areaCard = areasCard(d.locations, input.areas ?? null);
  if (areaCard) cards.push(areaCard);

  const have = new Map((t.faqs || []).map((f: FaqEntry) => [norm(f.question), f]));
  let faqs = 0;
  (d.faqs || []).forEach((f, i) => {
    const question = String(f?.question || "").trim();
    const answer = String(f?.answer || "").trim();
    if (!question || !answer || faqs >= FACT_CARDS_MAX_FAQS) return;
    const prev = have.get(norm(question));
    if (prev && norm(prev.answer) === norm(answer)) return;
    const ownerSet = !!prev && !NOT_OWNER.has(String(prev.source || "owner"));
    faqs += 1;
    cards.push({
      id: `faq:${i}`,
      kind: "faq",
      label: question,
      now: prev ? String(prev.answer).trim() || "Not set" : "Not set",
      found: answer,
      ownerSet,
      on: !ownerSet,
      question,
      answer,
      change: prev ? "changes" : "new",
    });
  });
  return cards;
}

/**
 * Hours from the draft: a sentence ("Mon-Fri 8 to 6, Sat half day") read on its own first, since the model's grid for
 * those is often a guess; else the model's grid. Keeps the stored hours location line (Locations owns it).
 */
function foundHours(d: { hoursSchedule?: unknown; hoursNotes?: string }, t: Tenant): { schedule: HoursSchedule; unsure: boolean; note: string | null } | null {
  const stored = parseHoursSchedule((t.hours_schedule as never) ?? null);
  const location = stored?.location || "";
  const fromText = parseHoursText(String(d.hoursNotes || ""), location);
  if (fromText) return fromText;
  const grid = parseHoursSchedule(d.hoursSchedule ?? null);
  if (grid) return { schedule: { ...grid, location }, unsure: false, note: null };
  return null;
}

const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** The business address found (first place): only the address and landmark, saved onto the first stored place. */
function addressCard(t: Tenant, locations: IngestDraft["locations"], ownerSet: boolean): FactCard | null {
  const first = (locations || []).find((l) => clean(l?.address, 160));
  if (!first) return null;
  const address = clean(first.address, 160);
  const landmark = clean(first.landmark, 120);
  if (/https?:|www\.|@/i.test(address) || address.length < 4) return null;
  const stored = normalizeBusinessLocations(t.business_locations || [])[0];
  const nowLine = stored ? [stored.address, stored.landmark].filter(Boolean).join(" · ") : "";
  const foundLine = [address, landmark && !stored?.landmark ? landmark : ""].filter(Boolean).join(" · ");
  const x = diff(stored?.address || "", address);
  if (x.same) return null;
  return {
    id: "address",
    kind: "address",
    label: "Business address",
    now: nowLine || "Not set",
    found: foundLine,
    ownerSet,
    on: !ownerSet,
    address,
    landmark,
  };
}

/** Place names in the found locations' coverage notes ("We serve Kilimani, Westlands and Karen"). */
export function foundAreaNames(locations: IngestDraft["locations"]): string[] {
  const out: string[] = [];
  for (const l of locations || []) {
    const notes = String((l as { coverage_notes?: string }).coverage_notes || "");
    for (const raw of notes.replace(/\b(we|serve|serving|cover|covering|deliver|delivery|to|in|areas?|around|only|also)\b/gi, ",").split(/[,;/|\n]|\band\b|&/i)) {
      const name = raw.replace(/[.()]/g, " ").replace(/\s+/g, " ").trim();
      if (name.length >= 3 && name.length <= 40) out.push(name);
    }
  }
  return [...new Set(out)].slice(0, 30);
}

function areasCard(locations: IngestDraft["locations"], areas: { picks: AreaPicks | null; confirmed: boolean } | null): FactCard | null {
  const stored = normalizeAreaPicks(areas?.picks ?? null);
  const served = new Set(stored.picks.filter((p) => p.serve).map((p) => p.node));
  const excluded = new Set(stored.picks.filter((p) => !p.serve).map((p) => p.node));
  const added: string[] = [];
  for (const name of foundAreaNames(locations)) {
    const node = matchAreaText(name);
    // A place the owner said they do not serve stays that way; Add many never flips it.
    if (!node || served.has(node.id) || excluded.has(node.id) || added.includes(node.id)) continue;
    added.push(node.id);
  }
  if (!added.length) return null;
  const nameOf = (id: string) => areaNode(id)?.name || id;
  const now = [...served].map(nameOf).join(", ");
  const ownerSet = !!areas?.confirmed;
  const picks = normalizeAreaPicks({ ...stored, picks: [...stored.picks, ...added.map((node) => ({ node, serve: true, fee_kes: null, note: null }))] });
  return { id: "areas", kind: "areas", label: "Areas you serve", now: now || "Not set", found: `Add ${added.map(nameOf).join(", ")}`, ownerSet, on: !ownerSet, picks };
}

const FACT_HINT = /\b(open|opens|opening|closed|hours|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rs|rsday)?|fri(day)?|sat(urday)?|sun(day)?|weekdays?|deliver(y|ies)?|deposit|refunds?|returns?|exchange|cancel(lation)?|warranty|guarantee|m-?pesa|paybill|till|pay(ment)?|cash|card|we serve|we cover|areas?|located|address|street|st|road|rd|avenue|ave|building|floor|plaza|mall|house|opposite|next to|weekdays?|daily)\b|\?/i;

/** Cheap check before spending a model call: does this text say anything about hours, policies, payment, areas or Q&A? */
export function mightHaveFacts(text: string): boolean {
  return FACT_HINT.test(String(text || "").slice(0, 20_000));
}

