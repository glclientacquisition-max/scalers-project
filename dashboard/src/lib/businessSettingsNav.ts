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
  | "alerts";

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
    raw === "alerts"
  ) {
    return raw;
  }
  // Updates live on Home. Appearance lives on the account menu.
  // Old ?tab=updates, ?tab=today, and ?tab=appearance bookmarks open the hub.
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
  /** One plain line for the Settings home list. */
  description: string;
  target: SettingsNavTarget;
};

export type SettingsNavSection = {
  id: "business" | "knowledge" | "assistant" | "people";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings with no section is the Settings home on every width
 * (phone: the whole screen; tablet and desktop: the right pane beside the rail).
 * One header each: Business, Knowledge, Assistant, People.
 * Import sits directly under Catalog. Team is People, ahead of Alerts.
 * Appearance is the account-menu theme cluster. It is not a settings tab.
 * URLs stay `?tab=` / `?panel=`.
 */
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "business",
    title: "Business",
    items: [
      { label: "Identity", description: "Name, type of business and how callers hear it", target: { tab: "train", panel: "identity" } },
      { label: "Hours", description: "When you are open, including holidays", target: { tab: "train", panel: "hours" } },
      { label: "Locations", description: "Where callers can find you", target: { tab: "train", panel: "locations" } },
      { label: "Policies", description: "Payments, delivery, returns and other rules", target: { tab: "train", panel: "policies" } },
    ],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    items: [
      { label: "Catalogue", description: "What you sell and what it costs", target: { tab: "catalog" } },
      { label: "Import", description: "Add items from a file or your website", target: { tab: "import" } },
      { label: "FAQs", description: "Answers to the questions callers ask most", target: { tab: "train", panel: "faqs" } },
    ],
  },
  {
    id: "assistant",
    title: "Assistant",
    items: [
      { label: "Voice", description: "How your Business Assistant sounds", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", description: "Names and words it should say a certain way", target: { tab: "train", panel: "pronunciation" } },
      { label: "Test", description: "Call your line and hear it answer", target: { tab: "test" } },
    ],
  },
  {
    id: "people",
    title: "People",
    items: [
      { label: "Team", description: "Who can use the desk and what they can do", target: { tab: "train", panel: "team" } },
      { label: "How we notify", description: "Where new calls and leads reach you", target: { tab: "alerts" } },
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

export function settingsNavItems(): SettingsNavItem[] {
  return SETTINGS_NAV.flatMap((section) => section.items);
}

export function settingsPanelHeading(
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel,
  vertical?: string | null
): string | null {
  if (tab === "menu") return null;
  if (tab === "catalog") return "Catalogue";
  if (tab === "alerts") return "How we notify";
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
  if (tab !== "train") return null;
  const item = settingsNavItems().find(
    (entry) => entry.target.tab === "train" && entry.target.panel === trainPanel
  );
  return item?.label ?? "Identity";
}
