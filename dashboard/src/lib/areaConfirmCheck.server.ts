import "server-only";
import type { OverviewDataCheck } from "@/components/structured/OverviewDataChecksCard";
import { AREA_CONFIRM_COPY, areaConfirmState, areaNeedsConfirm } from "@/lib/areaPicks";
import { loadAreaPicks, oldCoverageList } from "@/lib/areaPicks.server";

/** Desk home "Is this right?" row while service areas are unconfirmed or changed since confirm. Null when fine or on load error. */
export async function areaConfirmCheck(tenant: { id: string; service_areas?: unknown; business_policies?: unknown }): Promise<OverviewDataCheck | null> {
  const loaded = await loadAreaPicks(tenant.id);
  if (!loaded.ok) return null;
  const row = loaded.row;
  const state = areaConfirmState(
    row ? { confirmed_at: row.confirmed_at, updated_at: row.updated_at, pickCount: row.picks.picks.length } : null,
    oldCoverageList(tenant).length,
  );
  if (!areaNeedsConfirm(state)) return null;
  return {
    kind: "link",
    href: "/settings/areas",
    label: state === "edited" ? AREA_CONFIRM_COPY.editedTitle : AREA_CONFIRM_COPY.title,
    detail: AREA_CONFIRM_COPY.detail,
  };
}
