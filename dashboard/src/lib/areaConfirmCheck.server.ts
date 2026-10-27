import "server-only";
import type { OverviewDataCheck } from "@/components/structured/OverviewDataChecksCard";
import { loadAreaPicks, pendingOldList } from "@/lib/areaPicks.server";

/**
 * Desk home "Is this right?" row while the moved-over old area list is unchecked.
 * Same rule as Service areas (#964): old list present and picks never confirmed. Null when fine or on load error.
 */
export async function areaConfirmCheck(tenant: { id: string; service_areas?: unknown; business_policies?: unknown }): Promise<OverviewDataCheck | null> {
  const loaded = await loadAreaPicks(tenant.id);
  if (!loaded.ok) return null;
  if (!pendingOldList(tenant, loaded.row).length || loaded.row?.confirmed_at) return null;
  return {
    kind: "link",
    href: "/settings/areas?view=check",
    label: "Check your service areas",
    detail: "We moved your old area list onto the map. Check it once so callers hear the right places.",
  };
}
