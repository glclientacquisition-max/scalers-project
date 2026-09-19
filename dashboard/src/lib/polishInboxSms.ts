/**
 * Tighten an owner Inbox SMS draft. Distinct from polishCallerNote,
 * which turns a scratch note into a new customer SMS with a greeting.
 */

export const POLISH_INBOX_DRAFT_SYSTEM = `Rewrite the owner's SMS draft as a clearer, shorter customer SMS.
Return only the SMS body. No quotes. No markdown. Max 320 characters.
Keep the same language as the draft (English, Swahili, Sheng, or mixed).
Kenyan business tone: clear, short, direct.
Do not add a greeting, sign-off, or business name unless the draft already has one.
Keep the meaning. Do not invent a time, price, name, or place.
If the draft is already clear and short, return it with only light cleanup.`;

export function fallbackPolishInboxDraft(raw: string): string {
  const note = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "");
  if (!note) return "";
  const cased = note.charAt(0).toUpperCase() + note.slice(1);
  return cased.slice(0, 320);
}
