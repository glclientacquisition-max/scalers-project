"use server";

import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { deskImportPhoto } from "@/lib/deskFeatureFlags";
import { generateGeminiMultimodal } from "@/lib/gemini";
import { fetchPublicUrlSafe } from "@/lib/ingest/ssrfFetch";
import { htmlToPlainText } from "@/lib/ingest/sanitize";
import { PHOTO_MAX_BASE64, PHOTO_MIME, PHOTO_SYSTEM, photoReplyToLines, underImportLimit, websiteTextToLines } from "@/lib/importPhoto";

type LinesResult = { ok: true; text: string } | { ok: false; error: string };

async function gate(): Promise<{ id: string } | { error: string }> {
  if (!deskImportPhoto()) return { error: "This is not switched on yet." };
  const denied = await memberDenied("settings.edit");
  if (denied) return { error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };
  if (!underImportLimit(tenant.id)) return { error: "That is a lot of imports in an hour. Try again later." };
  return { id: tenant.id };
}

/** Add many from a photo: read the list in the photo into lines. Nothing is saved; the owner previews them next. */
export async function photoToLinesAction(mimeType: string, base64: string): Promise<LinesResult> {
  const t = await gate();
  if ("error" in t) return { ok: false, error: t.error };
  if (!(PHOTO_MIME as readonly string[]).includes(mimeType)) return { ok: false, error: "Use a JPG, PNG or WebP photo." };
  if (!base64 || base64.length > PHOTO_MAX_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { ok: false, error: "That photo is too large. Try a closer, smaller photo." };
  }
  try {
    const reply = await generateGeminiMultimodal({
      systemInstruction: PHOTO_SYSTEM,
      parts: [{ text: "Read the price list in this photo." }, { inlineData: { mimeType, data: base64 } }],
      temperature: 0,
      maxOutputTokens: 4096,
      timeoutMs: 25_000,
    });
    const text = photoReplyToLines(reply);
    if (!text) return { ok: false, error: "We could not read a list in that photo. Try a sharper photo, or type it." };
    return { ok: true, text };
  } catch {
    return { ok: false, error: "We could not read that photo right now. Try again, or type the list." };
  }
}

/** Add many from a website: fetch it safely and keep the lines that carry a price. Nothing is saved. */
export async function websiteToLinesAction(url: string): Promise<LinesResult> {
  const t = await gate();
  if ("error" in t) return { ok: false, error: t.error };
  try {
    const page = await fetchPublicUrlSafe(String(url || "").trim().slice(0, 500));
    const plain = /html/i.test(page.contentType) ? htmlToPlainText(page.text) : page.text;
    const text = websiteTextToLines(plain);
    if (!text) return { ok: false, error: "We found no prices on that page. Copy the list and paste it instead." };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.message ? err.message : "We could not open that website right now." };
  }
}
