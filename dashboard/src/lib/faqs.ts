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

const FAQ_SOURCES = new Set(["owner", "seed", "import", "inferred", "call_suggested"]);

export function clampFaq(entry: FaqEntry & Record<string, unknown>): FaqEntry {
  const question = String(entry?.question || "").trim().slice(0, FAQ_QUESTION_MAX);
  const answer = String(entry?.answer || "").trim().slice(0, FAQ_ANSWER_MAX);
  const out: FaqEntry & Record<string, unknown> = { question, answer };
  const source = String(entry?.source || "").trim().toLowerCase();
  const confirmed =
    entry?.confirmed === true || Boolean(entry?.confirmed_by || entry?.confirmed_at);
  if (FAQ_SOURCES.has(source)) out.source = source;
  if (confirmed) out.confirmed = true;
  if (entry?.confirmed_by) out.confirmed_by = String(entry.confirmed_by).slice(0, 80);
  if (entry?.confirmed_at) out.confirmed_at = String(entry.confirmed_at).slice(0, 40);
  const blocked =
    source === "seed" ||
    source === "call_suggested" ||
    source === "inferred" ||
    (source === "import" && !confirmed);
  const rawStatus = String(entry?.status || "").trim().toLowerCase();
  if (blocked) out.status = "suggested";
  else if (rawStatus === "golden" || rawStatus === "confirmed" || rawStatus === "suggested") {
    out.status = rawStatus;
  }
  return out;
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
      const incomingSource = String((clamped as FaqEntry & { source?: string }).source || "");
      const prevSource = String((prev as FaqEntry & { source?: string }).source || "");
      if (
        incomingSource === "call_suggested" &&
        prevSource !== "call_suggested" &&
        prevSource !== "seed" &&
        prevSource !== "inferred" &&
        prevSource !== "import"
      ) {
        skippedDuplicate += 1;
        continue;
      }
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
