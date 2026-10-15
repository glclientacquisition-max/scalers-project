/**
 * Compare imported items with what the business has saved. Every row is New, Update
 * (price change, new answer, new fee) or Same, and gets a default decision the owner can flip.
 * Nothing here writes. Pure and browser-safe.
 */
import type { ServiceItem } from "../servicesCatalog";
import type { ProductItem } from "../productCatalog";
import type { FaqEntry } from "../supabase";
import type { BusinessLocation } from "../businessLocations";
import type { BusinessPolicies } from "../businessPolicies";
import type { HoursSchedule } from "../hoursSchedule";
import type { ServiceAreas } from "../serviceAreas";
import { areasFromPlainText, coverageAreaLabel } from "../coverageAreas";
import { bestMatch, fuzzyKey, nameSimilarity } from "./catalogMatch";
import { parseKesPrice } from "./kes";
import { DAY_KEYS, PROFILE_LABELS, type ProfileField, type SmartItem, type SmartTarget } from "./schema";

/** Saved business profile values (read only here; profile rows never overwrite on their own). */
export type SavedProfile = Partial<Record<ProfileField, string>>;

export type SavedSettings = {
  services: ServiceItem[];
  products: ProductItem[];
  faqs: FaqEntry[];
  locations: BusinessLocation[];
  serviceAreas: ServiceAreas;
  policies: BusinessPolicies;
  hours: HoursSchedule | null;
  profile?: SavedProfile;
};

export type DiffStatus = "new" | "update" | "same";
export type DiffDecision = "add" | "update" | "skip";

export type DiffRow = {
  key: string;
  item: SmartItem;
  target: SmartTarget;
  status: DiffStatus;
  /** Saved row this matched (index into the saved list for that target), or -1. */
  matchIndex: number;
  /** Plain words for the row: "Price 250 to 300", "Already saved". */
  change: string;
  decision: DiffDecision;
  needsReview: boolean;
  /** Coverage: resolved place id. "" means it is not in the place list and cannot be added. */
  areaId?: string;
  /** False when the row cannot be applied (unknown place, profile fields applied by hand). */
  applicable: boolean;
  /** Low confidence or torn between two tabs: shown under "Not sure where this goes". */
  unsure: boolean;
};

/** Low confidence, or the model named a second destination: the owner picks the tab. */
export function isUnsure(item: SmartItem): boolean {
  return item.confidence === "low" || Boolean(item.alt_target);
}

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

/** Two price texts mean the same price ("1,500 KES" and "1500"). */
export function samePrice(a: unknown, b: unknown): boolean {
  const pa = parseKesPrice(a);
  const pb = parseKesPrice(b);
  if (!pa.text && !pb.text) return true;
  return pa.text === pb.text;
}

function defaultDecision(status: DiffStatus, needsReview: boolean, applicable: boolean): DiffDecision {
  if (!applicable || status === "same") return "skip";
  if (needsReview) return "skip";
  return status === "new" ? "add" : "update";
}

function row(
  item: SmartItem,
  i: number,
  status: DiffStatus,
  matchIndex: number,
  change: string,
  extra: Partial<DiffRow> = {}
): DiffRow {
  // Business profile changes always ask for a look and are never ticked by default.
  const needsReview = item.confidence !== "high" || item.target === "profile";
  const applicable = extra.applicable ?? true;
  const unsure = isUnsure(item);
  return {
    key: `${item.target}:${i}`,
    item,
    target: item.target,
    status,
    matchIndex,
    change,
    needsReview,
    applicable,
    unsure,
    decision: defaultDecision(status, needsReview || unsure, applicable),
    ...extra,
  };
}

function priceChange(before: string, after: string): string {
  if (!norm(before)) return `Adds price ${after}`;
  return `Price ${norm(before)} to ${after}`;
}

/** Diff every item. Duplicates inside one import collapse onto the first one. */
export function diffImport(items: SmartItem[], saved: SavedSettings): DiffRow[] {
  const out: DiffRow[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const dupKey = `${item.target}:${item.profile_field}:${fuzzyKey(item.name || item.question || item.area || item.address || item.policy_kind || item.text || item.target)}`;
    if (item.target !== "hours" && item.target !== "payments" && seen.has(dupKey)) return;
    seen.add(dupKey);
    switch (item.target) {
      case "services":
      case "products": {
        const list = item.target === "services" ? saved.services : saved.products;
        const m = bestMatch(item.name, item.aliases, list as Array<ServiceItem | ProductItem>, (r) => [
          r.name,
          ...("aliases" in r && Array.isArray(r.aliases) ? r.aliases : []),
        ]);
        if (m.index < 0) {
          out.push(row(item, i, "new", -1, item.price ? `New at ${item.price}` : "New, no price"));
          return;
        }
        const current = list[m.index] as ServiceItem & ProductItem;
        const before = item.target === "services" ? current.price_range : current.price;
        if (!item.price || samePrice(before, item.price)) {
          out.push(row(item, i, "same", m.index, `Already saved as ${current.name}`));
        } else {
          out.push(row(item, i, "update", m.index, priceChange(before, item.price)));
        }
        return;
      }
      case "faqs": {
        const idx = saved.faqs.findIndex((f) => nameSimilarity(f.question, item.question) >= 0.9);
        if (idx < 0) out.push(row(item, i, "new", -1, "New answer"));
        else if (norm(saved.faqs[idx].answer).toLowerCase() === item.answer.toLowerCase())
          out.push(row(item, i, "same", idx, "Already saved"));
        else out.push(row(item, i, "update", idx, "Different answer"));
        return;
      }
      case "locations": {
        const idx = saved.locations.findIndex(
          (l) =>
            (item.address && nameSimilarity(l.address, item.address) >= 0.86) ||
            (item.name && nameSimilarity(l.label, item.name) >= 0.95 && !item.address)
        );
        if (idx < 0) out.push(row(item, i, "new", -1, "New place"));
        else if (!item.landmark || norm(saved.locations[idx].landmark) === item.landmark)
          out.push(row(item, i, "same", idx, "Already saved"));
        else out.push(row(item, i, "update", idx, "Adds a landmark"));
        return;
      }
      case "coverage": {
        const ids = areasFromPlainText(item.area) as string[];
        const areaId = ids[0] || "";
        if (!areaId) {
          out.push(row(item, i, "new", -1, "Not in the place list. Add it by hand.", { applicable: false, areaId: "" }));
          return;
        }
        const label = coverageAreaLabel(areaId);
        const idx = saved.serviceAreas.areas.findIndex((a) => a.id === areaId);
        const feeText = item.fee_ksh == null ? "fee to confirm" : item.fee_ksh === 0 ? "free" : `fee ${item.fee_ksh}`;
        if (idx < 0) {
          out.push(row(item, i, "new", -1, `${label}, ${feeText}`, { areaId }));
          return;
        }
        const area = saved.serviceAreas.areas[idx];
        const savedFee = area.fee_mode === "free" ? 0 : area.fee_mode === "fixed" ? area.fee_ksh : null;
        if (item.fee_ksh == null || item.fee_ksh === savedFee)
          out.push(row(item, i, "same", idx, `${label} already saved`, { areaId }));
        else
          out.push(
            row(item, i, "update", idx, `${label} fee ${savedFee == null ? "to confirm" : savedFee} to ${item.fee_ksh}`, { areaId })
          );
        return;
      }
      case "hours": {
        const savedDays = saved.hours?.days;
        if (!savedDays) {
          out.push(row(item, i, "new", -1, "Sets your weekly hours"));
          return;
        }
        const differs = DAY_KEYS.some((d) => {
          const incoming = item.days[d];
          if (!incoming) return false;
          const cur = savedDays[d];
          const curText = cur ? `${cur.open}-${cur.close}` : "closed";
          return curText !== incoming;
        });
        out.push(differs ? row(item, i, "update", 0, "Changes your weekly hours") : row(item, i, "same", 0, "Same as your hours"));
        return;
      }
      case "profile": {
        const field = item.profile_field as ProfileField;
        const current = norm(saved.profile?.[field]);
        const label = PROFILE_LABELS[field] || "Profile";
        // Proposed change only: applied by the owner on Business profile, never by import.
        const extra = { applicable: field === "business_name" };
        if (!current) out.push(row(item, i, "new", -1, `${label}: ${item.text}`, extra));
        else if (current.toLowerCase() === item.text.toLowerCase()) out.push(row(item, i, "same", 0, `${label} already saved`, extra));
        else out.push(row(item, i, "update", 0, `${label}: ${current} to ${item.text}`, extra));
        return;
      }
      case "payments":
      case "policies": {
        const kind = item.target === "payments" ? "payment" : item.policy_kind;
        const current = norm((saved.policies as unknown as Record<string, unknown>)[kind]);
        if (!current) out.push(row(item, i, "new", -1, item.target === "payments" ? "Adds how customers pay" : `Adds ${kind} rule`));
        else if (current.toLowerCase() === item.text.toLowerCase()) out.push(row(item, i, "same", 0, "Already saved"));
        else out.push(row(item, i, "update", 0, `Replaces your ${kind} text`));
        return;
      }
    }
  });
  return out;
}

export type DiffCounts = { total: number; new: number; update: number; same: number; review: number; selected: number };

export function diffCounts(rows: DiffRow[]): DiffCounts {
  return {
    total: rows.length,
    new: rows.filter((r) => r.status === "new").length,
    update: rows.filter((r) => r.status === "update").length,
    same: rows.filter((r) => r.status === "same").length,
    review: rows.filter((r) => r.needsReview).length,
    selected: rows.filter((r) => r.decision !== "skip").length,
  };
}

export type DiffGroupKey = SmartTarget | "unsure";

/** Rows grouped by destination tab, in Settings order. Unsure rows sit in their own group. */
export function groupByTarget(rows: DiffRow[]): Array<{ target: DiffGroupKey; rows: DiffRow[] }> {
  const order: SmartTarget[] = ["profile", "services", "products", "faqs", "locations", "coverage", "hours", "payments", "policies"];
  const groups: Array<{ target: DiffGroupKey; rows: DiffRow[] }> = order
    .map((target) => ({ target: target as DiffGroupKey, rows: rows.filter((r) => r.target === target && !r.unsure) }))
    .filter((g) => g.rows.length);
  const unsure = rows.filter((r) => r.unsure);
  if (unsure.length) groups.unshift({ target: "unsure", rows: unsure });
  return groups;
}

/**
 * The owner picked a destination for an unsure row: re-diff it there. It is no longer unsure,
 * keeps its key, and still waits for a tick.
 */
export function moveRow(row: DiffRow, target: SmartTarget, saved: SavedSettings): DiffRow {
  const item: SmartItem = { ...row.item, target, alt_target: "", confidence: row.item.confidence === "low" ? "medium" : row.item.confidence };
  if ((target === "services" || target === "products") && !item.name) item.name = item.text || item.question || item.area;
  if (target === "coverage" && !item.area) item.area = item.name;
  if ((target === "payments" || target === "policies" || target === "profile") && !item.text) item.text = item.name || item.answer;
  if (target === "policies" && !item.policy_kind) item.policy_kind = "other";
  const [next] = diffImport([item], saved);
  if (!next) return { ...row, unsure: false };
  return { ...next, key: row.key, unsure: false, decision: "skip" };
}
