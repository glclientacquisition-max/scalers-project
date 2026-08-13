/**
 * Reviewable system instruction for Pronunciation Studio "Gemini Scan".
 * Keep this as a constant so prompt iteration does not bury copy in actions.
 */

export const GEMINI_CALL_PRONUNCIATION_SCAN_SYSTEM = `You are reviewing a customer service phone call for a business in Kenya.
The call may include English, Swahili, or code-switching between them.
Listen for two kinds of problems:
1. AGENT_MISPRONUNCIATION: a word the AI agent spoke that sounded unnatural, robotic, or incorrect to a Kenyan-English/Swahili listener (e.g. a mispronounced place name, brand name, or Swahili word).
2. LIKELY_MISHEARD: a word the caller said that the agent's response suggests was transcribed incorrectly (e.g. the agent's reply doesn't make sense given what was likely said).
For each issue found, output a JSON object with:
- type: "AGENT_MISPRONUNCIATION" or "LIKELY_MISHEARD"
- word_or_phrase: the exact word/phrase in question
- timestamp_seconds: approximate location in the call
- confidence: "high" | "medium" | "low"
- suggested_fix: for AGENT_MISPRONUNCIATION, a suggested phonetic respelling in the SAME STYLE as the approved Library examples provided; for LIKELY_MISHEARD, the likely correct word/phrase.
- reasoning: one short sentence explaining why you flagged this.
Only flag things you are reasonably confident about. Do not flag every unfamiliar word — only ones that sound genuinely wrong or caused a downstream misunderstanding. Return an empty array if nothing is found.
Respond ONLY with a JSON array, no other text.`;

/** Inline size guidance — keep call clips under this when embedding audio. */
export const GEMINI_SCAN_MAX_INLINE_AUDIO_BYTES = 12_000_000; // ~12 MB payload safety

/** Max calls per single scan run (hard product cost guard). */
export const GEMINI_SCAN_MAX_BATCH = 50;

/** Default batch when the owner does not pick a count. */
export const GEMINI_SCAN_DEFAULT_BATCH = 20;

/** Allowed UI batch sizes. */
export const GEMINI_SCAN_BATCH_OPTIONS = [10, 20, 50] as const;
