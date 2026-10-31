"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { getSupabaseAdmin } from "@/lib/supabase";
import { bustTenantCache } from "@/lib/tenantCache";
import { isMissingCallSetup, loadCallSetupState } from "@/lib/callSetupServer";
import { mergeCallSetup, parseCallSetup, type CallSetup } from "@/lib/callSetupStore";

export type CallSetupSaveResult =
  | { ok: true; setup: CallSetup }
  | { ok: false; error: string; unsupported?: boolean };

/**
 * Save call setup picks for the signed-in owner's business. Owners and admins only
 * (Settings rule); the save_call_setup RPC checks membership again in SQL.
 * `opened` stamps opened_at the first time the step is opened.
 */
export async function saveCallSetupAction(
  tenantId: string,
  patch: Partial<CallSetup>,
  opts: { opened?: boolean } = {}
): Promise<CallSetupSaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const [tenant, ws] = await Promise.all([getCurrentTenant(), createWorkspaceDataClient()]);
  if (!tenant || !ws) return { ok: false, error: "Not signed in." };
  if (tenant.id !== tenantId) return { ok: false, error: "That business isn't open. Reload the page." };

  const read = await ws.client.from("tenants").select("call_setup").eq("id", tenant.id).maybeSingle();
  if (read.error) {
    return isMissingCallSetup(read.error.message)
      ? { ok: false, error: "Saved on this phone only.", unsupported: true }
      : { ok: false, error: "Couldn't save. Try again." };
  }
  const stored = (read.data as { call_setup?: unknown } | null)?.call_setup;
  const next = mergeCallSetup(stored == null ? null : parseCallSetup(stored), patch, {
    nowIso: new Date().toISOString(),
    opened: opts.opened,
  });

  let saved: unknown = null;
  let error: { message: string } | null = null;
  if (ws.mode === "owner") {
    const res = await ws.client.rpc("save_call_setup", { p_tenant: tenant.id, p_next: next });
    saved = res.data;
    error = res.error;
  } else {
    // Legacy ops desk (service role, no auth.uid()): same validation via the column check.
    const res = await getSupabaseAdmin()
      .from("tenants")
      .update({ call_setup: { ...next, updated_at: new Date().toISOString() } })
      .eq("id", tenant.id)
      .select("call_setup")
      .maybeSingle();
    saved = (res.data as { call_setup?: unknown } | null)?.call_setup ?? null;
    error = res.error;
  }
  if (error) {
    return isMissingCallSetup(error.message)
      ? { ok: false, error: "Saved on this phone only.", unsupported: true }
      : { ok: false, error: "Couldn't save. Try again." };
  }
  bustTenantCache(tenant.id);
  revalidatePath("/home");
  return { ok: true, setup: parseCallSetup(saved ?? next) };
}

export type CallSetupTestCheck =
  | { ok: true; matchedAt: string | null; matchedCallId?: string | null; setup: CallSetup | null }
  | { ok: false; error: string };

/**
 * Poll while the test window is open: did a call from the test phone come in?
 * On a match, saves tested_via "auto" (save_call_setup checks the call exists).
 */
export async function checkCallSetupTestAction(tenantId: string): Promise<CallSetupTestCheck> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant || tenant.id !== tenantId) return { ok: false, error: "That business isn't open. Reload the page." };
  const state = await loadCallSetupState(tenant.id);
  if (!state.supported || !state.setup) return { ok: true, matchedAt: null, setup: state.setup };
  const matchedAt = state.activity?.testMatchAt ?? null;
  if (!matchedAt || state.setup.tested_at) return { ok: true, matchedAt, setup: state.setup };
  const saved = await saveCallSetupAction(tenant.id, { tested_at: matchedAt, tested_via: "auto" });
  const matchedCallId = state.activity?.testMatchCallId ?? null;
  return { ok: true, matchedAt, matchedCallId, setup: saved.ok ? saved.setup : state.setup };
}
