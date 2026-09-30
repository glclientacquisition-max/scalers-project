export type SettingsPanel =
  | "catalog"
  | "identity"
  | "hours"
  | "locations"
  | "policies"
  | "team"
  | "faqs"
  | "tools"
  | "pronunciation";

export type BusinessSettingsTab =
  | "menu"
  | "catalog"
  | "train"
  | "import"
  | "test"
  | "alerts"
  | "appearance";

const TRAIN_PANEL_ALIAS = new Set<string>([
  "identity",
  "hours",
  "locations",
  "policies",
  "team",
  "faqs",
  "tools",
  "pronunciation",
]);

/** `?tab=identity` is the same panel as `?tab=train&panel=identity`. */
export function isTrainPanelAlias(raw: string | undefined | null): boolean {
  return TRAIN_PANEL_ALIAS.has(String(raw || ""));
}

export function parseBusinessSettingsTab(
  raw: string | undefined | null
): BusinessSettingsTab {
  if (isTrainPanelAlias(raw)) return "train";
  if (
    raw === "catalog" ||
    raw === "train" ||
    raw === "import" ||
    raw === "test" ||
    raw === "alerts" ||
    raw === "appearance"
  ) {
    return raw;
  }
  // Updates live on Home. Old ?tab=updates and ?tab=today bookmarks open the hub.
  return "menu";
}

export function parseBusinessSettingsPanel(
  raw: string | undefined | null,
  tabRaw?: string | null
): SettingsPanel {
  if (isTrainPanelAlias(raw)) return raw as SettingsPanel;
  if (isTrainPanelAlias(tabRaw)) return tabRaw as SettingsPanel;
  return "identity";
}

export function businessSettingsHref(tab: BusinessSettingsTab, panel?: SettingsPanel) {
  if (tab === "menu") return "/settings";
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (tab === "train" && panel) q.set("panel", panel);
  return `/settings?${q.toString()}`;
}

/** Sidebar target. Same tabs and panels. Grouped by owner job. */
export type SettingsNavTarget =
  | { tab: Exclude<BusinessSettingsTab, "train" | "menu"> }
  | { tab: "train"; panel: Exclude<SettingsPanel, "catalog"> };

export type SettingsNavItem = {
  label: string;
  target: SettingsNavTarget;
};

export type SettingsNavSection = {
  id: "business" | "assistant" | "knowledge" | "alerts";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings is the phone index.
 * Business → Assistant → Knowledge → Alerts.
 * Appearance stays on the account menu (`?tab=appearance`), not this index.
 * Extra shipped panels sit in the closest group. URLs stay `?tab=` / `?panel=`.
 */
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "business",
    title: "Business",
    items: [
      { label: "Identity", target: { tab: "train", panel: "identity" } },
      { label: "Hours", target: { tab: "train", panel: "hours" } },
      { label: "Locations", target: { tab: "train", panel: "locations" } },
      { label: "Policies", target: { tab: "train", panel: "policies" } },
    ],
  },
  {
    id: "assistant",
    title: "Assistant",
    items: [
      { label: "Voice", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", target: { tab: "train", panel: "pronunciation" } },
      { label: "Test", target: { tab: "test" } },
    ],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    items: [
      { label: "FAQs", target: { tab: "train", panel: "faqs" } },
      { label: "Catalog", target: { tab: "catalog" } },
      { label: "Import", target: { tab: "import" } },
    ],
  },
  {
    id: "alerts",
    title: "Alerts",
    items: [
      { label: "Alerts", target: { tab: "alerts" } },
      { label: "Team", target: { tab: "train", panel: "team" } },
    ],
  },
];

export function settingsNavHref(target: SettingsNavTarget): string {
  return target.tab === "train"
    ? businessSettingsHref("train", target.panel)
    : businessSettingsHref(target.tab);
}

export function settingsNavItemActive(
  target: SettingsNavTarget,
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel,
  options?: { selectHubIdentity?: boolean }
): boolean {
  if (target.tab === "train") {
    if (tab === "train" && trainPanel === target.panel) return true;
    return (
      target.panel === "identity" &&
      Boolean(options?.selectHubIdentity) &&
      tab === "menu"
    );
  }
  return tab === target.tab;
}

export function settingsNavItems(): SettingsNavItem[] {
  return SETTINGS_NAV.flatMap((section) => section.items);
}

export function settingsPanelHeading(
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel,
  vertical?: string | null
): string | null {
  if (tab === "menu") return null;
  if (tab === "catalog") return "Catalog";
  if (tab === "alerts") return "Alerts";
  if (tab === "import") {
    const v = String(vertical || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    return v === "retail" || v === "shop" || v === "shops"
      ? "Import Catalog"
      : "Import Knowledge";
  }
  if (tab === "test") return "Test";
  if (tab === "appearance") return "Appearance";
  if (tab !== "train") return null;
  const item = settingsNavItems().find(
    (entry) => entry.target.tab === "train" && entry.target.panel === trainPanel
  );
  return item?.label ?? "Identity";
}
