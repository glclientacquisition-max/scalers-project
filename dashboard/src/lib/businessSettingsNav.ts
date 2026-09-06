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
  | "test";

export function parseBusinessSettingsTab(
  raw: string | undefined | null
): BusinessSettingsTab {
  if (raw === "catalog" || raw === "train" || raw === "import" || raw === "test") {
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
  id: "general" | "knowledge" | "operations" | "line";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings is the menu.
 * Who we are → what we know → how we run → prove the line.
 */
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "general",
    title: "General",
    items: [
      { label: "Updates", target: { tab: "updates" } },
      { label: "Assistant", target: { tab: "train", panel: "identity" } },
      { label: "Team", target: { tab: "train", panel: "team" } },
    ],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    items: [
      { label: "Catalog", target: { tab: "catalog" } },
      { label: "FAQs", target: { tab: "train", panel: "faqs" } },
      { label: "Import", target: { tab: "import" } },
    ],
  },
  {
    id: "operations",
    title: "Operations",
    items: [
      { label: "Hours", target: { tab: "train", panel: "hours" } },
      { label: "Locations", target: { tab: "train", panel: "locations" } },
      { label: "Policies", target: { tab: "train", panel: "policies" } },
    ],
  },
  {
    id: "line",
    title: "Line",
    items: [
      { label: "Tools & voice", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", target: { tab: "train", panel: "pronunciation" } },
      { label: "Test", target: { tab: "test" } },
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
  trainPanel: SettingsPanel
): boolean {
  if (target.tab === "train") {
    return tab === "train" && trainPanel === target.panel;
  }
  return tab === target.tab;
}

export function settingsPanelHeading(
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel
): string | null {
  if (tab === "menu") return null;
  if (tab === "catalog") return "Catalog";
  if (tab !== "train") return null;
  for (const section of SETTINGS_NAV) {
    const item = section.items.find(
      (entry) => entry.target.tab === "train" && entry.target.panel === trainPanel
    );
    if (item) return item.label;
  }
  return "Assistant";
}
