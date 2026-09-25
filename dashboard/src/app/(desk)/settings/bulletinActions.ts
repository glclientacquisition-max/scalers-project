"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { isAuthenticated } from "@/lib/auth";
import {
  canPostBulletin,
  deskBulletinItems,
  normalizeBulletin,
  resolveBulletinWindow,
  validateBulletinText,
  type BulletinExpiry,
  type BulletinItem,
} from "@/lib/dailyBulletin";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";

export type BulletinActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
};

async function loadBulletin(): Promise<{
  tenantId: string;
  items: BulletinItem[];
} | { error: string }> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to update today's notes." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }
  return {
    tenantId: tenant.id,
    items: normalizeBulletin(tenant.daily_bulletin),
  };
}

async function saveBulletin(
  tenantId: string,
  items: BulletinItem[]
): Promise<{ error?: string }> {
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { error } = await workspace.client
    .from("tenants")
    .update({ daily_bulletin: items })
    .eq("id", tenantId);

  if (error) {
    return ownerSaveFailed("bulletin", error.message);
  }
  revalidatePath("/settings");
  revalidatePath("/home");
  return {};
}

export async function postBulletinAction(
  _prev: BulletinActionState,
  formData: FormData
): Promise<BulletinActionState> {
  const loaded = await loadBulletin();
  if ("error" in loaded) return { error: loaded.error };

  const tenantIdCheck = String(formData.get("tenant_id") || "").trim();
  if (!tenantIdCheck || tenantIdCheck !== loaded.tenantId) {
    return { error: "Forbidden." };
  }

  const validated = validateBulletinText(String(formData.get("text") || ""));
  if (!validated.ok) return { error: validated.error };

  const expiryRaw = String(formData.get("expiry") || "today").trim().toLowerCase();
  const expiry: BulletinExpiry =
    expiryRaw === "tomorrow" || expiryRaw === "manual" || expiryRaw === "schedule"
      ? expiryRaw
      : "today";

  const window = resolveBulletinWindow({
    expiry,
    startsLocal: String(formData.get("starts_at") || ""),
    endsLocal: String(formData.get("ends_at") || ""),
  });
  if (!window.ok) return { error: window.error };

  const gate = canPostBulletin(loaded.items);
  if (!gate.ok) return { error: gate.error };

  const now = new Date();
  const item: BulletinItem = {
    id: randomUUID(),
    text: validated.text,
    active: true,
    starts_at: window.starts_at,
    ends_at: window.ends_at,
    created_at: now.toISOString(),
  };

  const open = deskBulletinItems(loaded.items, now);
  const inactive = loaded.items
    .filter((row) => !open.some((l) => l.id === row.id))
    .slice(-20);

  const next = [...open, item, ...inactive];
  const saved = await saveBulletin(loaded.tenantId, next);
  if (saved.error) return { error: saved.error };

  const scheduled = new Date(window.starts_at) > now;
  return {
    ok: true,
    message: scheduled
      ? "Update is set. Callers hear it after the start."
      : "Update is live for the next call.",
  };
}

export async function clearBulletinAction(
  _prev: BulletinActionState,
  formData: FormData
): Promise<BulletinActionState> {
  const loaded = await loadBulletin();
  if ("error" in loaded) return { error: loaded.error };

  const tenantIdCheck = String(formData.get("tenant_id") || "").trim();
  if (!tenantIdCheck || tenantIdCheck !== loaded.tenantId) {
    return { error: "Forbidden." };
  }

  const id = String(formData.get("bulletin_id") || "").trim();
  if (!id) return { error: "Missing update id." };

  const next = loaded.items.map((item) =>
    item.id === id
      ? { ...item, active: false, ends_at: new Date().toISOString() }
      : item
  );

  const saved = await saveBulletin(loaded.tenantId, next);
  if (saved.error) return { error: saved.error };

  return { ok: true, message: "Update cleared." };
}
