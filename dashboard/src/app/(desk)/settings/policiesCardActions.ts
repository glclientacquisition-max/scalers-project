"use server";

import { revalidatePath } from "next/cache";
import { saveAndCompileSettings, type SettingsCompileState } from "@/app/(desk)/settings/actions";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import {
  applyPoliciesPatch,
  ownerPathsForPatch,
  policiesKind,
  policiesNiche,
  sanitizePoliciesPatch,
  type PoliciesPatch,
} from "@/lib/policiesRemake";

export type PoliciesCardResult = { ok: true } | { ok: false; error: string; fields?: Record<string, string> };

/**
 * Settings › Policies: one card's save. The patch is merged on the server onto the stored
 * business_policies (read fresh), so a card never writes another card's keys, and the
 * save goes through the same settings save and compile as every other panel
 * (scope policies-rules: business_policies only, When unsure stays as stored).
 */
export async function savePoliciesCardAction(raw: PoliciesPatch): Promise<PoliciesCardResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };

  const patch = sanitizePoliciesPatch(raw);
  const niche = policiesNiche(tenant, policiesKind(tenant));
  const stored = (tenant.business_policies as Record<string, unknown> | null) ?? {};
  const merged = applyPoliciesPatch(stored, patch, niche);

  const formData = new FormData();
  formData.set("id", tenant.id);
  formData.set("settings_scope", "policies-rules");
  formData.set("business_policies", JSON.stringify(merged));
  formData.set("owner_field_paths", JSON.stringify(ownerPathsForPatch(patch)));
  const res: SettingsCompileState = await saveAndCompileSettings({}, formData);
  if (res.error) return { ok: false, error: res.error, fields: res.fields };
  revalidatePath("/home");
  return { ok: true };
}

export type PoliciesUnknownInput = { line: string; english: string; swahili: string; touched: boolean };

/** Settings › Policies › When unsure: saves only the unsure line (and its spoken pair). */
export async function savePoliciesUnknownAction(input: PoliciesUnknownInput): Promise<SettingsCompileState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "Not signed in." };
  const formData = new FormData();
  formData.set("id", tenant.id);
  formData.set("settings_scope", "policies-unknown");
  formData.set("unknown_answer_fallback", String(input?.line ?? "").slice(0, 1200));
  formData.set("unknown_answer_spoken_en", String(input?.english ?? "").slice(0, 220));
  formData.set("unknown_answer_spoken_sw", String(input?.swahili ?? "").slice(0, 220));
  formData.set("unknown_answer_spoken_touched", input?.touched ? "1" : "0");
  return saveAndCompileSettings({}, formData);
}
