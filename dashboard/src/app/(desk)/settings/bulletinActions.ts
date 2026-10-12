"use server";

import { bustTenantCache } from "@/lib/tenantCache";
import { memberDenied } from "@/lib/requireMember";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { isAuthenticated } from "@/lib/auth";
import {
  applyBulletinEdit,
  canPostBulletin,
  deskBulletinItems,
  normalizeBulletin,
  parseAnnounce,
  resolveBulletinWindow,
  validateBulletinText,
  type BulletinAnnounce,
  type BulletinExpiry,
  type BulletinItem,
} from "@/lib/dailyBulletin";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { ownerSaveFailed } from "@/lib/ownerFacingError";
import { fieldPathsAttestedOnBulletinSave } from "@/lib/fieldPathsFromSettingsSave";
import { ownerAttestFields } from "@/lib/ownerAttestFields";
import { getAuthUser } from "@/lib/auth";

export type BulletinActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
  /** Changes on every result so the panel shows the latest action's message. */
  at?: number;
};

const CONFLICT = "Someone else just changed updates. Check the list and try again.";

type Mutate = (items: BulletinItem[]) => { next: BulletinItem[] } | { error: string };

/**
 * Read the stored list, apply the change, and save only if nobody changed it in
 * between (save_daily_bulletin compares the stored list). One retry on a fresh read.
 */
async function mutateBulletin(formData: FormData, mutate: Mutate): Promise<{ error?: string }> {
  if (!(await isAuthenticated())) return { error: "Sign in to change updates." };
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const tenantIdCheck = String(formData.get("tenant_id") || "").trim();
  if (!tenantIdCheck || tenantIdCheck !== tenant.id) return { error: "Forbidden." };
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  let stored: unknown = tenant.daily_bulletin ?? [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      const { data, error } = await workspace.client.from("tenants").select("daily_bulletin").eq("id", tenant.id).maybeSingle();
      if (error) return ownerSaveFailed("bulletin", error.message);
      stored = data?.daily_bulletin ?? [];
    }
    const result = mutate(normalizeBulletin(stored));
    if ("error" in result) return { error: result.error };
    const { data: saved, error } = await workspace.client.rpc("save_daily_bulletin", {
      p_tenant: tenant.id,
      p_expected: Array.isArray(stored) ? stored : [],
      p_next: result.next,
    });
    if (error) return ownerSaveFailed("bulletin", error.message);
    if (saved === true) {
      bustTenantCache(tenant.id);
      const user = await getAuthUser();
      await ownerAttestFields(tenant.id, fieldPathsAttestedOnBulletinSave(result.next.length > 0), user?.id ?? null);
      revalidatePath("/settings");
      revalidatePath("/home");
      return {};
    }
  }
  bustTenantCache(tenant.id);
  return { error: CONFLICT };
}

function readCompose(formData: FormData):
  | { ok: true; text: string; announce: BulletinAnnounce; starts_at: string; ends_at: string | null }
  | { ok: false; error: string } {
  const validated = validateBulletinText(String(formData.get("text") || ""));
  if (!validated.ok) return validated;
  const expiryRaw = String(formData.get("expiry") || "today").trim().toLowerCase();
  const expiry: BulletinExpiry =
    expiryRaw === "tomorrow" || expiryRaw === "manual" || expiryRaw === "schedule" ? expiryRaw : "today";
  const window = resolveBulletinWindow({
    expiry,
    startsLocal: String(formData.get("starts_at") || ""),
    endsLocal: String(formData.get("ends_at") || ""),
  });
  if (!window.ok) return window;
  if (window.ends_at && new Date(window.ends_at) <= new Date()) return { ok: false, error: "Pick an end in the future." };
  return {
    ok: true,
    text: validated.text,
    announce: parseAnnounce(formData.get("announce")) ?? "ask",
    starts_at: window.starts_at,
    ends_at: window.ends_at,
  };
}

const done = (message: string): BulletinActionState => ({ ok: true, message, at: Date.now() });
const fail = (error: string): BulletinActionState => ({ error, at: Date.now() });

export async function postBulletinAction(_prev: BulletinActionState, formData: FormData): Promise<BulletinActionState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return fail(denied.error);
  const compose = readCompose(formData);
  if (!compose.ok) return fail(compose.error);
  const now = new Date();
  const item: BulletinItem = {
    id: randomUUID(),
    text: compose.text,
    announce: compose.announce,
    active: true,
    starts_at: compose.starts_at,
    ends_at: compose.ends_at,
    created_at: now.toISOString(),
  };
  const res = await mutateBulletin(formData, (items) => {
    const gate = canPostBulletin(items, now);
    if (!gate.ok) return { error: gate.error };
    const open = deskBulletinItems(items, now);
    const inactive = items.filter((row) => !open.some((l) => l.id === row.id)).slice(-20);
    return { next: [...open, item, ...inactive] };
  });
  if (res.error) return fail(res.error);
  if (new Date(compose.starts_at) > now) return done("Update is set. Callers hear it after the start.");
  return done(compose.announce === "always" ? "Posted. Every caller hears it from the next call." : "Posted. Callers hear it when they ask.");
}

export async function editBulletinAction(_prev: BulletinActionState, formData: FormData): Promise<BulletinActionState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return fail(denied.error);
  const id = String(formData.get("bulletin_id") || "").trim();
  if (!id) return fail("Missing update id.");
  const compose = readCompose(formData);
  if (!compose.ok) return fail(compose.error);
  const res = await mutateBulletin(formData, (items) => {
    if (!items.some((item) => item.id === id && item.active)) return { error: "That update was cleared. Post it again." };
    const { ok: _ok, ...patch } = compose;
    return { next: applyBulletinEdit(items, id, patch) };
  });
  if (res.error) return fail(res.error);
  return done("Update saved.");
}

export async function clearBulletinAction(_prev: BulletinActionState, formData: FormData): Promise<BulletinActionState> {
  const denied = await memberDenied("settings.edit");
  if (denied) return fail(denied.error);
  const id = String(formData.get("bulletin_id") || "").trim();
  if (!id) return fail("Missing update id.");
  const res = await mutateBulletin(formData, (items) => ({
    next: items.map((item) => (item.id === id ? { ...item, active: false, ends_at: new Date().toISOString() } : item)),
  }));
  if (res.error) return fail(res.error);
  return done("Update cleared.");
}
