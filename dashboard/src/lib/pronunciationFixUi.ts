/**
 * Pure helpers for Pronunciation Fix-tab UX.
 * Keep owner flow: Review → Add → Find more.
 */

import type { PronunciationReviewCandidate } from "@/lib/pronunciationGeminiScan";

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
  /** Primary CTA label */
  primaryAction: "record" | "dismiss";
  /** Whether Approve spelling is offered */
  canApproveSpelling: boolean;
};

/** Recommended owner path — used in UI copy and docs. */
export const PRONUNCIATION_BEST_FLOW = [
  "Practice pack lines (Greeting / Location / Team) and Keep good takes.",
  "On Fix: clear Needs review first (Record preferred, or Approve spelling).",
  "Add a word you heard wrong → Record it (typed spelling is a fallback).",
  "Find more: Quick scan (transcripts) for names; AI listen (Gemini) for audio drafts.",
  "Verify on Test → Play phone preview, then call the live DID.",
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
        kindLabel: "Phone says wrong",
        phrase: c.word_or_phrase,
        suggested: c.suggested_form,
        confidence: c.confidence,
        reasoning: c.reasoning,
        candidate: c,
        primaryAction: "record",
        canApproveSpelling: true,
      })
    );

  const hearing = (opts.hearing || [])
    .filter((c) => c.status === "pending" && c.type === "LIKELY_MISHEARD")
    .map(
      (c): FixReviewRow => ({
        id: c.id,
        kind: "hearing",
        kindLabel: "Likely misheard",
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
