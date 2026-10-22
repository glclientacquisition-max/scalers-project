/** SMS parts for one body: 160 GSM chars (153 per part when split), 70 UCS-2 (67). Client safe. */
export function smsSegments(body: string): number {
  const text = String(body || "");
  if (!text) return 0;
  const ucs2 = /[^\x00-\x7F]/.test(text);
  const single = ucs2 ? 70 : 160;
  const concat = ucs2 ? 67 : 153;
  if (text.length <= single) return 1;
  return Math.ceil(text.length / concat);
}
