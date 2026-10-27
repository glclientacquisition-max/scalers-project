"use server";

import { revalidatePath } from "next/cache";
import { getAuthUser } from "@/lib/auth";
import { normalizeAreaPicks } from "@/lib/areaPicks";
import { loadAreaPicks, pendingOldList, saveAreaPicks } from "@/lib/areaPicks.server";
import { memberDenied } from "@/lib/requireMember";
import { getCurrentTenant } from "@/lib/tenant";

export type AreaSaveResult = { ok: true; message: string } | { ok: false; error: string };

/** Save bar and "Looks right". Picks are re-normalised against the tree on the server. */
export async function saveAreaPicksAction(raw: unknown, confirm = false): Promise<AreaSaveResult> {
  const denied = await memberDenied("settings.edit");
  if (denied) return { ok: false, error: denied.error };
  const tenant = await getCurrentTenant();
  if (!tenant) return { ok: false, error: "Not signed in." };
  const user = await getAuthUser();
  // Once picks exist, coverage_areas is the mirror of them (areaPicksToCoverageAreas), not an old list.
  const existing = confirm ? await loadAreaPicks(tenant.id) : null;
  const res = await saveAreaPicks(tenant.id, normalizeAreaPicks(raw), {
    confirm,
    movedFrom: confirm && existing?.ok ? pendingOldList(tenant, existing.row) : null,
    userId: user?.id ?? null,
  });
  if (!res.ok) return { ok: false, error: "Could not save your areas. Try again." };
  revalidatePath("/settings/areas");
  return { ok: true, message: confirm ? "Areas checked and saved." : "Areas saved." };
}
