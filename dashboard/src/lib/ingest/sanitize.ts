/** Turn messy HTML / page text into clean plain text for the extractor. */

const MAX_CHARS = 40_000;

export function htmlToPlainText(raw: string): string {
  let s = String(raw || "");

  // Drop scripts/styles/noscript early
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  // Line breaks for common block tags
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|br|hr)>/gi, "\n");
  s = s.replace(/<(br|hr)\s*\/?>/gi, "\n");
  s = s.replace(/<\/?(ul|ol|table|section|article|header|footer)>/gi, "\n");

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, " ");

  // Decode a few common entities
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  // Collapse whitespace
  s = s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (s.length > MAX_CHARS) {
    s = `${s.slice(0, MAX_CHARS)}\n\n[truncated]`;
  }
  return s;
}

export function normalizePasteText(raw: string): string {
  const s = String(raw || "")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > MAX_CHARS) {
    return `${s.slice(0, MAX_CHARS)}\n\n[truncated]`;
  }
  return s;
}
