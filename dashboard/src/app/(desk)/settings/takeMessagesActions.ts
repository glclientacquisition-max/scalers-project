"use server";

import { revalidatePath } from "next/cache";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";
import { setBrainModeAsOwner } from "@/lib/kbLive.server";
import { loadBrainSettings } from "@/lib/takeMessages.server";
import { brainSettingError, ownerCanChange, type TakeMessagesState } from "@/lib/takeMessages";

export type TakeMessagesResult = { ok: true; state: TakeMessagesState } | { ok: false; error: string };

/**
 * Settings > Identity, "Take messages only". on = brain_mode 'safe', off = 'full'.
 * Writes only through set_brain_mode with the owner's session (setBrainModeAsOwner): the database
 * checks owner / admin membership and audits. A hold that Scalers support or the env put on
 * stays: the owner can't turn it off from here.
 */
export async function setTakeMessagesAction(on: boolean): Promise<TakeMessagesResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  if (typeof on !== "boolean") return { ok: false, error: brainSettingError("invalid_mode") };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const now = await loadBrainSettings(tenant.id);
  if (!now.takeMessages) return { ok: false, error: brainSettingError("rpc_missing") };
  if (!ownerCanChange(now.takeMessages)) {
    return { ok: false, error: "Scalers support turned this on. Contact Scalers support to turn it off." };
  }
  if (now.takeMessages.on === on) return { ok: true, state: now.takeMessages };
  const r = await setBrainModeAsOwner(tenant.id, on ? "safe" : "full");
  if (!r.ok) return { ok: false, error: brainSettingError(r.error) };
  revalidatePath("/settings");
  revalidatePath("/calls");
  // Read back: BRAIN_SAFE_MODE=all still wins over the owner's choice.
  const after = await loadBrainSettings(tenant.id);
  return { ok: true, state: after.takeMessages ?? { on: r.mode === "safe", by: r.mode === "safe" ? "owner" : null, setAt: r.setAt } };
}
