"use server";

import { revalidatePath } from "next/cache";
import { saveAndCompileSettings, type SettingsCompileState } from "@/app/(desk)/settings/actions";
import { confirmPriceAction, type StructuredResult } from "@/app/(desk)/settings/structuredActions";
import {
  applyStructuredPolicies,
  businessPoliciesForStorage,
  normalizeBusinessPolicies,
} from "@/lib/businessPolicies";
import { factSaveIsConfirm } from "@/lib/deskFeatureFlags";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { normalizePayments, type Payments } from "@/lib/payments";
import type { StructuredPrice } from "@/lib/structuredData";
import { parseHoursSchedule, type HoursSchedule } from "@/lib/hoursSchedule";

function policiesFormData(tenantId: string, policiesJson: string, ownerPaths: string[]): FormData {
  const formData = new FormData();
  formData.set("id", tenantId);
  formData.set("settings_scope", "policies");
  formData.set("business_policies", policiesJson);
  formData.set("owner_field_paths", JSON.stringify(ownerPaths));
  return formData;
}

/** Overview sheet: same policies save path as Settings › Policies. */
export async function saveOverviewPaymentsAction(payments: Payments): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };

  const cleaned = normalizePayments(payments);
  if (!cleaned) return { ok: false, error: "Add how customers pay." };

  const policies = normalizeBusinessPolicies(tenant.business_policies);
  const merged = {
    ...policies,
    payments: { ...cleaned, source: "owner" as const, confirmed: true },
  };
  const structured = applyStructuredPolicies(merged);
  if (!structured.ok) {
    return { ok: false, error: structured.error, fields: structured.fields };
  }

  const ownerPaths = factSaveIsConfirm() ? ["payments.methods"] : [];
  const formData = policiesFormData(
    tenant.id,
    JSON.stringify(businessPoliciesForStorage(structured.policies)),
    ownerPaths
  );
  const res: SettingsCompileState = await saveAndCompileSettings({}, formData);
  if (res.error) return { ok: false, error: res.error, fields: res.fields };
  revalidatePath("/home");
  revalidatePath("/settings");
  return { ok: true, message: "Payment details saved." };
}

/** Overview sheet: one confirmPriceAction per row (Catalogue save path). */
export async function saveOverviewPricesAction(
  items: Array<{ kind: "product" | "service"; id?: string | null; name: string; pricing: StructuredPrice }>
): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  if (!items.length) return { ok: false, error: "Nothing to save." };

  for (const item of items) {
    const res = await confirmPriceAction(item);
    if (!res.ok) return res;
  }
  revalidatePath("/home");
  return { ok: true, message: items.length === 1 ? "Price saved." : "Prices saved." };
}

function hoursFormData(tenantId: string, schedule: HoursSchedule, ownerPaths: string[]): FormData {
  const formData = new FormData();
  formData.set("id", tenantId);
  formData.set("settings_scope", "hours");
  formData.set("hours_schedule", JSON.stringify(schedule));
  formData.set("owner_field_paths", JSON.stringify(ownerPaths));
  return formData;
}

/** Overview sheet: same hours save path as Settings › Hours. */
export async function saveOverviewHoursAction(schedule: HoursSchedule): Promise<StructuredResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };

  const parsed = parseHoursSchedule(schedule);
  if (!parsed) return { ok: false, error: "Set at least one open day." };

  const ownerPaths = factSaveIsConfirm() ? ["hours.weekly_grid"] : [];
  const formData = hoursFormData(tenant.id, parsed, ownerPaths);
  const res: SettingsCompileState = await saveAndCompileSettings({}, formData);
  if (res.error) return { ok: false, error: res.error, fields: res.fields };
  revalidatePath("/home");
  revalidatePath("/settings");
  return { ok: true, message: "Opening hours saved." };
}
