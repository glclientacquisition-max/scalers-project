/** Up to three questions a caller could ask, from this business's FAQs and catalogue. */

const MAX = 3;

function pushUnique(out: string[], seen: Set<string>, text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const key = cleaned.toLowerCase();
  if (!cleaned || seen.has(key) || out.length >= MAX) return;
  seen.add(key);
  out.push(cleaned);
}

function faqQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const question = String((row as { question?: unknown }).question || "").trim();
    const answer = String((row as { answer?: unknown }).answer || "").trim();
    if (question && answer) out.push(question);
  }
  return out;
}

function catalogNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const name = String((row as { name?: unknown }).name || "").trim();
    if (name) out.push(name);
  }
  return out;
}

export function testLineQuestions(input: {
  faqs?: unknown;
  services?: unknown;
  products?: unknown;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const question of faqQuestions(input.faqs)) {
    pushUnique(out, seen, question);
  }
  for (const name of [...catalogNames(input.services), ...catalogNames(input.products)]) {
    pushUnique(out, seen, `How much is ${name}?`);
  }
  return out;
}
