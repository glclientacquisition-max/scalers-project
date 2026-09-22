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
  | "updates"
  | "catalog"
  | "train"
  | "import"
  | "test"
  | "alerts"
  | "appearance";

export function parseBusinessSettingsTab(
  raw: string | undefined | null
): BusinessSettingsTab {
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
  // "today" kept as a legacy alias for bookmarked /settings?tab=today links.
  if (raw === "updates" || raw === "today") {
    return "updates";
  }
  if (raw === "menu") return "menu";
  return "menu";
}

export function parseBusinessSettingsPanel(
  raw: string | undefined | null
): SettingsPanel {
  if (
    raw === "identity" ||
    raw === "hours" ||
    raw === "locations" ||
    raw === "policies" ||
    raw === "team" ||
    raw === "faqs" ||
    raw === "tools" ||
    raw === "pronunciation"
  ) {
    return raw;
  }
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
  id: "business" | "receptionist" | "knowledge" | "alerts" | "device";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings is the phone index.
 * Business → Receptionist → Knowledge → Alerts → This device.
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
    id: "receptionist",
    title: "Receptionist",
    items: [
      { label: "Voice", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", target: { tab: "train", panel: "pronunciation" } },
      { label: "Updates", target: { tab: "updates" } },
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
  {
    id: "device",
    title: "This device",
    items: [{ label: "Appearance", target: { tab: "appearance" } }],
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
  options?: { selectHubAppearance?: boolean }
): boolean {
  if (target.tab === "train") {
    return tab === "train" && trainPanel === target.panel;
  }
  if (
    target.tab === "appearance" &&
    options?.selectHubAppearance &&
    tab === "menu"
  ) {
    return true;
  }
  return tab === target.tab;
}

export function settingsNavItems(): SettingsNavItem[] {
  return SETTINGS_NAV.flatMap((section) => section.items);
}

export function settingsPanelHeading(
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel
): string | null {
  if (tab === "menu") return null;
  if (tab === "catalog") return "Catalog";
  if (tab !== "train") return null;
  const item = settingsNavItems().find(
    (entry) => entry.target.tab === "train" && entry.target.panel === trainPanel
  );
  return item?.label ?? "Identity";
}
