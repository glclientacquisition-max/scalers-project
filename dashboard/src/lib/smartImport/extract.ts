import "server-only";
/**
 * Smart import extraction: structured Gemini JSON for text, photos and PDFs, with the local
 * parsers as the fallback for text when the model is unavailable. A file never falls back
 * silently: if the model cannot read it, the owner is told.
 */
import { generateGeminiJson, type GeminiPart } from "@/lib/gemini";
import { extractLocally } from "@/lib/ingest/extract";
import { parseBulkProducts, parseProductCsv } from "@/lib/productCatalog";
import { DAY_KEYS, parseSmartImportJson, smartItem, SMART_IMPORT_RESPONSE_SCHEMA, SMART_IMPORT_SYSTEM, type SmartItem } from "./schema";
import { parseKesPrice } from "./kes";
import { IMPORT_FILE_TIMEOUT_MS } from "@/lib/ingest/fileInput";

const TEXT_MAX = 30_000;

export type SmartExtractResult = { items: SmartItem[]; source: "gemini" | "local" | "csv"; note?: string };

/** Local fallback: the existing knowledge parser and CSV reader mapped onto smart items. */
export function smartItemsLocally(text: string, opts: { retail: boolean; csv?: boolean }): SmartItem[] {
  if (opts.csv) {
    return parseProductCsv(text).map((p) =>
      smartItem(opts.retail ? "products" : "services", {
        name: p.name,
        price: parseKesPrice(p.price).text,
        unit: p.unit,
        category: p.category,
        aliases: p.aliases,
        notes: p.notes,
        confidence: "medium",
        evidence: p.name,
      })
    );
  }
  const draft = extractLocally(text, "import");
  const items: SmartItem[] = [];
  // "Name - price" lines: the bulk list parser keeps the price the knowledge parser drops.
  const pricedRows = parseBulkProducts(
    text.split("\n").filter((l) => /\d/.test(l) && !/^\s*[qa]\s*:/i.test(l)).join("\n")
  ).filter((p) => p.price);
  const priced = new Set(pricedRows.map((p) => p.name.toLowerCase()));
  for (const p of pricedRows) {
    items.push(smartItem(opts.retail ? "products" : "services", { name: p.name, price: parseKesPrice(p.price).text, evidence: `${p.name} ${p.price}` }));
  }
  for (const s of draft.services) {
    if (priced.has(s.name.toLowerCase()) || [...priced].some((k) => s.name.toLowerCase().startsWith(k))) continue;
    items.push(
      smartItem(opts.retail ? "products" : "services", {
        name: s.name,
        price: parseKesPrice(s.price_range).text,
        category: s.category,
        notes: s.notes,
        evidence: s.name,
      })
    );
  }
  for (const f of draft.faqs) items.push(smartItem("faqs", { question: f.question, answer: f.answer, evidence: f.question }));
  for (const l of draft.locations || []) {
    if (l.address) items.push(smartItem("locations", { name: l.label, address: l.address, landmark: l.landmark, evidence: l.address }));
  }
  if (draft.hoursSchedule) {
    const days: SmartItem["days"] = {};
    for (const d of DAY_KEYS) {
      const v = draft.hoursSchedule.days[d];
      days[d] = v ? `${v.open}-${v.close}` : "closed";
    }
    items.push(smartItem("hours", { days, evidence: draft.hoursNotes || "" }));
  }
  if (draft.policies?.payment) items.push(smartItem("payments", { text: draft.policies.payment, evidence: draft.policies.payment }));
  for (const kind of ["returns", "delivery", "deposit", "cancellation", "warranty"] as const) {
    const t = draft.policies?.[kind];
    if (t) items.push(smartItem("policies", { policy_kind: kind, text: t, evidence: t }));
  }
  // Local guesses are never "high": every row asks for a look.
  return items.map((i) => ({ ...i, confidence: i.confidence === "high" ? "medium" : i.confidence }));
}

export async function smartExtract(opts: {
  text?: string;
  file?: GeminiPart;
  csvText?: string;
  businessName: string;
  retail: boolean;
}): Promise<SmartExtractResult> {
  const text = String(opts.text || opts.csvText || "").slice(0, TEXT_MAX);
  const parts: GeminiPart[] = [];
  if (opts.file) parts.push(opts.file);
  parts.push({
    text: `Business: ${opts.businessName || "unknown"}\nKind: ${opts.retail ? "shop (products)" : "service business"}\n\nSOURCE:\n${text || "(see attached file)"}`,
  });
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  if (hasKey) {
    try {
      const raw = await generateGeminiJson({
        systemInstruction: SMART_IMPORT_SYSTEM,
        parts,
        responseSchema: SMART_IMPORT_RESPONSE_SCHEMA,
        timeoutMs: opts.file ? IMPORT_FILE_TIMEOUT_MS : 30_000,
      });
      const items = parseSmartImportJson(raw);
      if (items.length || opts.file) return { items, source: "gemini" };
    } catch (err) {
      if (opts.file) {
        const msg = err instanceof Error ? err.message : "";
        throw new Error(
          /timed out/i.test(msg)
            ? "Reading that file took too long. Try fewer pages or a clearer photo."
            : "We couldn't read that file right now. Try again, or paste the text instead."
        );
      }
      console.warn("[smart-import] model failed, using local parser", err instanceof Error ? err.message : err);
    }
  } else if (opts.file) {
    throw new Error("Reading photos and PDFs isn't switched on yet. Paste the text instead.");
  }
  if (opts.csvText) return { items: smartItemsLocally(opts.csvText, { retail: opts.retail, csv: true }), source: "csv" };
  return { items: smartItemsLocally(text, { retail: opts.retail }), source: "local", note: "Read without AI. Check each row." };
}
