import type { FaqEntry } from "@/lib/supabase";

export const FAQ_MAX = 25;
export const FAQ_QUESTION_MAX = 200;
export const FAQ_ANSWER_MAX = 400;

/** No invented answers. An empty FAQ list stays empty until the owner writes one. */
export const FAQ_STARTERS: FaqEntry[] = [];

export function normalizeFaqKey(question: string): string {
  return String(question || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clampFaq(entry: FaqEntry): FaqEntry {
  const next: FaqEntry = {
    ...entry,
    question: String(entry.question || "").trim().slice(0, FAQ_QUESTION_MAX),
    answer: String(entry.answer || "").trim().slice(0, FAQ_ANSWER_MAX),
  };
  const source = String(next.source || "").trim();
  const status = String(next.status || "").trim();
  if (source) next.source = source;
  else delete next.source;
  if (status) next.status = status;
  else delete next.status;
  const confirmedBy = String(next.confirmed_by || "").trim();
  const confirmedAt = String(next.confirmed_at || "").trim();
  if (confirmedBy) next.confirmed_by = confirmedBy.slice(0, 80);
  else delete next.confirmed_by;
  if (confirmedAt) next.confirmed_at = confirmedAt.slice(0, 40);
  else delete next.confirmed_at;
  if (next.confirmed !== true) delete next.confirmed;
  return next;
}

export function isNearDuplicateFaq(question: string, existing: FaqEntry[]): boolean {
  const key = normalizeFaqKey(question);
  if (!key) return true;
  return existing.some((f) => {
    const other = normalizeFaqKey(f.question);
    if (!other) return false;
    if (other === key) return true;
    if (other.includes(key) || key.includes(other)) {
      return Math.min(other.length, key.length) >= 12;
    }
    return false;
  });
}

export type FaqMergeResult = {
  faqs: FaqEntry[];
  added: number;
  updated: number;
  skippedDuplicate: number;
  skippedCap: number;
};

/**
 * Merge picked FAQs into existing ones with honest accounting.
 * Same normalized question updates the answer (so a call can correct an FAQ).
 */
export function mergeFaqs(opts: {
  existing: FaqEntry[];
  picked: FaqEntry[];
  mode?: "merge" | "replace";
}): FaqMergeResult {
  const mode = opts.mode || "merge";
  const map = new Map<string, FaqEntry>();

  if (mode === "merge") {
    for (const f of opts.existing) {
      const clamped = clampFaq(f);
      if (!clamped.question || !clamped.answer) continue;
      map.set(normalizeFaqKey(clamped.question), clamped);
    }
  }

  let added = 0;
  let updated = 0;
  let skippedDuplicate = 0;
  let skippedCap = 0;

  for (const f of opts.picked) {
    const clamped = clampFaq(f);
    if (!clamped.question || !clamped.answer) continue;
    const key = normalizeFaqKey(clamped.question);
    const prev = map.get(key);

    if (prev) {
      if (prev.answer === clamped.answer && prev.question === clamped.question) {
        skippedDuplicate += 1;
        continue;
      }
      // Update in place — does not consume a new slot.
      map.set(key, clamped);
      updated += 1;
      continue;
    }

    if (map.size >= FAQ_MAX) {
      skippedCap += 1;
      continue;
    }
    map.set(key, clamped);
    added += 1;
  }

  return {
    faqs: [...map.values()].slice(0, FAQ_MAX),
    added,
    updated,
    skippedDuplicate,
    skippedCap,
  };
}

export function formatFaqMergeMessage(result: FaqMergeResult): string {
  const parts: string[] = [];
  if (result.added) {
    parts.push(`Added ${result.added} FAQ${result.added === 1 ? "" : "s"}`);
  }
  if (result.updated) {
    parts.push(`updated ${result.updated}`);
  }
  if (!parts.length) {
    if (result.skippedCap) {
      return `FAQs are full (max ${FAQ_MAX}). Remove one, then try again.`;
    }
    return "Those FAQs are already on file. Nothing new to add.";
  }
  let msg = `${parts.join(" and ")}. Live on the next call.`;
  if (result.skippedCap) {
    msg += ` ${result.skippedCap} could not fit (max ${FAQ_MAX}).`;
  }
  return msg;
}
