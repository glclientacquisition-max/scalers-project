import "server-only";
import { SETTINGS_NAV } from "@/lib/businessSettingsNav";
import { loadPlanRowStatus } from "@/lib/ownerPlanLoad";
import {
  settingsIndexStatuses,
  type SettingsListStatus,
  type SettingsStatusTenant,
} from "@/lib/settingsOptionStatus";

const PLAN_KEY = "/settings/plan";

/** Row statuses for the Settings list and rail, with the plan name on the Plan row. */
export async function loadSettingsStatuses(
  tenant: SettingsStatusTenant & { id: string },
  voices: Parameters<typeof settingsIndexStatuses>[1] = [],
): Promise<Record<string, SettingsListStatus>> {
  const targets = SETTINGS_NAV.flatMap((section) => section.items.map((item) => item.target));
  const statuses = settingsIndexStatuses(tenant, voices, targets);
  const plan = await loadPlanRowStatus(tenant.id);
  return plan.row ? { ...statuses, [PLAN_KEY]: plan.row } : statuses;
}
