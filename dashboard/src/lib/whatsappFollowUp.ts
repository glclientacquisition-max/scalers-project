/** Owner-writable note on `calls.resolution_note` after a wa.me click. */
export const WHATSAPP_FOLLOWUP_NOTE = "WhatsApp follow-up opened";

export function appendWhatsAppFollowUpNote(
  existing: string | null | undefined
): string {
  const cur = String(existing || "").trim();
  if (cur.includes(WHATSAPP_FOLLOWUP_NOTE)) return cur;
  return cur ? `${cur}. ${WHATSAPP_FOLLOWUP_NOTE}` : WHATSAPP_FOLLOWUP_NOTE;
}
