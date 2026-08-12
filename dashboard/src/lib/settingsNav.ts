import type { SettingsPanel } from "@/components/TenantForm";

export const SETTINGS_TABS = [
  "today",
  "catalog",
  "train",
  "import",
  "test",
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(raw: string | null | undefined): SettingsTabId {
  if (
    raw === "catalog" ||
    raw === "train" ||
    raw === "import" ||
    raw === "test"
  ) {
    return raw;
  }
  return "today";
}

export function parseSettingsTrainPanel(
  raw: string | null | undefined
): SettingsPanel {
  if (
    raw === "identity" ||
    raw === "hours" ||
    raw === "team" ||
    raw === "faqs" ||
    raw === "tools"
  ) {
    return raw;
  }
  return "identity";
}
