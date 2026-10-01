/**
 * Pure helpers for Pronunciation Fix-tab UX.
 * Keep owner flow: Review → Add → Find more.
 */

import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";

function reviewNameKey(phrase: string): string {
  return String(phrase || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type FixReviewKind = "speech" | "hearing";

export type FixReviewRow = {
  id: string;
  kind: FixReviewKind;
  /** Short chip for owners */
  kindLabel: string;
  phrase: string;
  suggested: string;
  confidence: PronunciationReviewCandidate["confidence"];
  reasoning: string;
  candidate: PronunciationReviewCandidate;
  /** Filled control when present. Hearing rows have no filled control. */
  primaryAction: "use" | "dismiss";
  /** Ghost spelling field. It does not write until Use this. */
  canApproveSpelling: boolean;
};

/** Recommended owner path. Not rendered as a subtitle. */
export const PRONUNCIATION_BEST_FLOW = [
  "Practice the pack line. Record line, then Use this take.",
  "Needs review. Hear, then Use this.",
  "Add a word and record it. Typed spelling stays a fallback.",
  "Find more with AI listen. Scan stays under the review list. Fixes stay on review until Use this.",
  "Test. Play phone preview, then call the line.",
] as const;

/**
 * One glance queue: speech fixes first (actionable), then hearing hints.
 */
export function buildUnifiedFixReviewRows(opts: {
  speech: PronunciationReviewCandidate[];
  hearing: PronunciationReviewCandidate[];
}): FixReviewRow[] {
  const speech = (opts.speech || [])
    .filter((c) => c.status === "pending" && c.type === "AGENT_MISPRONUNCIATION")
    .map(
      (c): FixReviewRow => ({
        id: c.id,
        kind: "speech",
        kindLabel: "Speech",
        phrase: c.word_or_phrase,
        suggested: c.suggested_form,
        confidence: c.confidence,
        reasoning: c.reasoning,
        candidate: c,
        primaryAction: "use",
        canApproveSpelling: true,
      })
    );

  const hearing = (opts.hearing || [])
    .filter((c) => c.status === "pending" && c.type === "LIKELY_MISHEARD")
    .map(
      (c): FixReviewRow => ({
        id: c.id,
        kind: "hearing",
        kindLabel: "Hearing",
        phrase: c.word_or_phrase,
        suggested: c.suggested_form,
        confidence: c.confidence,
        reasoning: c.reasoning,
        candidate: c,
        primaryAction: "dismiss",
        canApproveSpelling: false,
      })
    );

  return [...speech, ...hearing];
}

/** Hearing Hear is optional. A name or a proposed say of at least two letters can be spoken. */
export function reviewRowSpeakable(phrase: string, say: string): boolean {
  return reviewNameKey(phrase).length >= 2 || reviewNameKey(say).length >= 2;
}

export function fixTabHint(pendingReviewCount: number): string {
  if (pendingReviewCount > 0) return `${pendingReviewCount} to review`;
  return "Clear";
}

/** Desk preview request body checks (mirrors API route rules). */
export function validatePhonePreviewRequest(body: {
  text?: unknown;
  lexicon?: unknown;
  voiceId?: unknown;
}): { ok: true; text: string } | { ok: false; error: string } {
  const text = String(body.text || "").trim();
  if (!text) return { ok: false, error: "Preview text required (max 500 characters)." };
  if (text.length > 500) {
    return { ok: false, error: "Preview text required (max 500 characters)." };
  }
  return { ok: true, text };
}
