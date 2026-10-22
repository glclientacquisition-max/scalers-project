/**
 * Kenyan caller number to international digits (no +), or null.
 * 07xx / 01xx → 2547xx / 2541xx. 9 digits starting 7 or 1 → 254 + digits.
 * 254… and +254… stay. Anything else (withheld, short, foreign) → null, so no button.
 */
export function kePhoneDigits(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  return null;
}
