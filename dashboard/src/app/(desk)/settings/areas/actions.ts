"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth";
import { normalizeAreaPicks } from "@/lib/areaPicks";
import { oldCoverageList, saveAreaPicks } from "@/lib/areaPicks.server";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";

export type AreaSaveResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Save bar, "Confirm" and "Looks right". The owner's own save on this page also confirms (Brain #942 reads only
 * confirmed picks), so `confirm` is true from the live page. Picks are re-normalised against the tree on the server.
 */
export async function saveAreaPicksAction(raw: unknown, confirm = false): Promise<AreaSaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const user = await getAuthUser();
  const res = await saveAreaPicks(tenant.id, normalizeAreaPicks(raw), {
    confirm,
    movedFrom: confirm ? oldCoverageList(tenant) : null,
    userId: user?.id ?? null,
  });
  if (!res.ok) return { ok: false, error: "Could not save your areas. Try again." };
  revalidatePath("/settings/areas");
  revalidatePath("/home");
  return { ok: true, message: confirm ? "Saved. Callers now get these answers." : "Areas saved." };
}
