"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { underImportLimit } from "@/lib/importPhoto";
import { findFactCards } from "@/lib/foundFacts.server";
import { clampFaq, mergeFaqs } from "@/lib/faqs";
import type { FactCard } from "@/lib/factCards";
import type { FaqEntry } from "@/lib/supabase";
import { emptyLocation, normalizeBusinessLocations } from "@/lib/businessLocations";
import { saveAndCompileSettings } from "@/app/(desk)/settings/actions";

export type FactsResult = { ok: true; cards: FactCard[] } | { ok: false; error: string };
export type FactSaveResult = { ok: true } | { ok: false; error: string };

/** Add many (Paste and File): the facts in the same text the item preview reads. Nothing is saved. */
export async function findFactsAction(text: string): Promise<FactsResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  if (String(text || "").length > 200_000) return { ok: true, cards: [] };
  if (!underImportLimit(`facts:${tenant.id}`, Date.now(), 20)) return { ok: true, cards: [] };
  return { ok: true, cards: await findFactCards(tenant, text, "pasted text") };
}

/**
 * One found FAQ card: merged onto the stored FAQs (a new question is added, the same question gets the found answer),
 * then saved through the Settings FAQs save (scope "faqs": FAQs only, every other field stays as stored).
 */
export async function saveFoundFaqAction(input: { question: string; answer: string }): Promise<FactSaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const picked = clampFaq({ question: String(input?.question || ""), answer: String(input?.answer || ""), source: "import" });
  if (!picked.question || !picked.answer) return { ok: false, error: "That question has no answer." };
  const existing = (Array.isArray(tenant.faqs) ? tenant.faqs : []) as FaqEntry[];
  const merged = mergeFaqs({ existing, picked: [picked], mode: "merge" });
  if (merged.skippedCap) return { ok: false, error: "You have 25 FAQs already. Remove one in Settings › FAQs first." };
  if (!merged.added && !merged.updated) return { ok: true };
  const formData = new FormData();
  formData.set("id", tenant.id);
  formData.set("settings_scope", "faqs");
  formData.set("faqs", JSON.stringify(merged.faqs));
  formData.set("owner_field_paths", "[]");
  const res = await saveAndCompileSettings({}, formData);
  if (res.error) return { ok: false, error: res.error };
  revalidatePath("/settings");
  return { ok: true };
}

const cleanText = (v: unknown, max: number) =>
  String(v ?? "").replace(/[\u0000-\u001f\u007f<>]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The found business address: set on the first stored place (a new "Main" place when there is none). Only that
 * place's address changes, and its landmark only when empty. Saved with scope "locations-address", so location
 * notes, service areas, the no-premises switch and every other setting stay as stored.
 */
export async function saveFoundAddressAction(input: { address: string; landmark?: string }): Promise<FactSaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const address = cleanText(input?.address, 160);
  const landmark = cleanText(input?.landmark, 120);
  if (address.length < 4 || /https?:|www\.|@/i.test(address)) return { ok: false, error: "That address does not look right." };
  const places = normalizeBusinessLocations(tenant.business_locations || []);
  if (!places.length) places.push({ ...emptyLocation(), label: "Main", address, landmark });
  else places[0] = { ...places[0], address, landmark: places[0].landmark || landmark };
  const formData = new FormData();
  formData.set("id", tenant.id);
  formData.set("settings_scope", "locations-address");
  formData.set("business_locations", JSON.stringify(places));
  formData.set("owner_field_paths", "[]");
  const res = await saveAndCompileSettings({}, formData);
  if (res.error) return { ok: false, error: res.error };
  revalidatePath("/settings");
  return { ok: true };
}
