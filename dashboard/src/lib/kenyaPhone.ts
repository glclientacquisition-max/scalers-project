/** Normalize Kenyan mobile numbers to E.164 (+254…). */
export function normalizeKenyaPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("254") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+254${digits.slice(1)}`;
  if (digits.length >= 9) return `+254${digits}`;
  return null;
}
