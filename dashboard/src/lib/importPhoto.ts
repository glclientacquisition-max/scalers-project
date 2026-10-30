import { z } from "zod";

/**
 * Add many from a photo or a website (DESK_IMPORT_PHOTO). Both end as paste-style lines ("Name, price"), so the owner
 * sees the same preview and nothing is saved until they tap Add. Pure helpers here; the server actions call them.
 */
export const PHOTO_MAX_BASE64 = 900_000; // the client shrinks the photo first; server actions take about 1 MB
export const PHOTO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_LINES = 200;

export const PHOTO_SYSTEM = [
  "You read a photo of a price list, menu or rate card from a Kenyan business.",
  'Return JSON only: {"items":[{"name":"...","price":"..."}],"notes":"..."}.',
  "notes: copy, as written, any other lines you can read about opening hours, how to pay (M-Pesa, paybill, till), delivery, deposit, returns, areas served, or questions and answers. \"\" when there are none.",
  "One entry per item or service you can actually read. Copy the name as written.",
  'price: copy it as written (e.g. "KSh 1,500", "500 - 800", "from 2,000"), or "" when there is none.',
  "Do not guess prices, do not translate, do not add items that are not in the photo. If it is not a list, return {\"items\":[]}.",
].join("\n");

const PhotoItems = z.object({
  items: z.array(z.object({ name: z.string(), price: z.union([z.string(), z.number()]).optional() })).max(500),
  notes: z.string().optional(),
});

function parsePhotoReply(raw: string) {
  const body = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const r = PhotoItems.safeParse(JSON.parse(body));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** The photo's other text (hours, payment, delivery, areas, Q&A) for the found-facts cards. "" when none. */
export function photoReplyNotes(raw: string): string {
  return String(parsePhotoReply(raw)?.notes || "").trim().slice(0, 4000);
}

/** Model reply → paste lines. Anything that is not the expected JSON is no lines (the owner sees "could not read"). */
export function photoReplyToLines(raw: string): string {
  const data = parsePhotoReply(raw);
  if (!data) return "";
  return data.items
    .map((it) => {
      const name = it.name.replace(/[\r\n,]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
      const price = String(it.price ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
      return name ? (price ? `${name}, ${price}` : name) : "";
    })
    .filter(Boolean)
    .slice(0, PHOTO_MAX_LINES)
    .join("\n");
}

const PRICE_ON_LINE = /(?:\bksh?s?\.?|\bkes\b|\bsh\.?\s*\d|\d\s*\/=|\d[\d,]{2,}(?:\.\d+)?\s*$)/i;

/** Website plain text → only short lines that carry a price (headings, menus and prose drop out). */
export function websiteTextToLines(plain: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of String(plain || "").split(/\n+/)) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (line.length < 3 || line.length > 90 || !/[a-z]/i.test(line) || !PRICE_ON_LINE.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= PHOTO_MAX_LINES) break;
  }
  return out.join("\n");
}

/** In-memory limit per workspace (best effort per server instance; the durable limit needs the PR 9 table). */
const hits = new Map<string, number[]>();
export function underImportLimit(key: string, now = Date.now(), max = 10, windowMs = 60 * 60_000): boolean {
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}
