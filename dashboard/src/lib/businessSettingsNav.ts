export type SettingsPanel =
  | "catalog"
  | "identity"
  | "hours"
  | "team"
  | "faqs"
  | "tools";

export type BusinessSettingsTab =
  | "today"
  | "catalog"
  | "train"
  | "import"
  | "test";

export function parseBusinessSettingsTab(
  raw: string | undefined | null
): BusinessSettingsTab {
  if (raw === "catalog" || raw === "train" || raw === "import" || raw === "test") {
    return raw;
  }
  return "today";
}

export function parseBusinessSettingsPanel(
  raw: string | undefined | null
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

export function businessSettingsHref(tab: BusinessSettingsTab, panel?: SettingsPanel) {
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (tab === "train" && panel) q.set("panel", panel);
  return `/settings?${q.toString()}`;
}
