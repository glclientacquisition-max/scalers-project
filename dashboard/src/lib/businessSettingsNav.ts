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
  target: SettingsNavTarget;
};

export type SettingsNavSection = {
  id: "business" | "offer" | "assistant" | "people";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings is the phone index.
 * Wide screens open Hours. Phone keeps this list.
 * Job order: Identity, Hours, Catalog, Import, FAQs, Locations, Policies,
 * Team, Voice, Pronunciation, Alerts, Test.
 * A group header repeats when the job order returns to that group.
 * Import sits directly under Catalog. Team is People, not under Alerts.
 * Appearance is the account-menu theme cluster. It is not a settings tab.
 * URLs stay `?tab=` / `?panel=`.
 */
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "business",
    title: "Business",
    items: [
      { label: "Identity", target: { tab: "train", panel: "identity" } },
      { label: "Hours", target: { tab: "train", panel: "hours" } },
    ],
  },
  {
    id: "offer",
    title: "Offer",
    items: [
      { label: "Catalog", target: { tab: "catalog" } },
      { label: "Import", target: { tab: "import" } },
      { label: "FAQs", target: { tab: "train", panel: "faqs" } },
    ],
  },
  {
    id: "business",
    title: "Business",
    items: [
      { label: "Locations", target: { tab: "train", panel: "locations" } },
      { label: "Policies", target: { tab: "train", panel: "policies" } },
    ],
  },
  {
    id: "people",
    title: "People",
    items: [{ label: "Team", target: { tab: "train", panel: "team" } }],
  },
  {
    id: "assistant",
    title: "Assistant",
    items: [
      { label: "Voice", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", target: { tab: "train", panel: "pronunciation" } },
    ],
  },
  {
    id: "people",
    title: "People",
    items: [{ label: "Alerts", target: { tab: "alerts" } }],
  },
  {
    id: "assistant",
    title: "Assistant",
    items: [{ label: "Test", target: { tab: "test" } }],
  },
];

/** Wide-screen destination for `/settings` with no tab. */
export const SETTINGS_HOURS_HREF = businessSettingsHref("train", "hours");

/**
 * md+ visits to `/settings` with no tab open Hours.
 * No cookie (phone, or a first paint the server cannot see) stays on the index.
 * `?tab=train` stays Identity so Home Train does not jump to Hours.
 */
export function settingsWideDefaultHref(
  tabRaw: string | undefined | null,
  deskMd: string | undefined | null
): string | null {
  if (tabRaw) return null;
  if (deskMd !== "1") return null;
  return SETTINGS_HOURS_HREF;
}

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
  if (tab !== "train") return null;
  const item = settingsNavItems().find(
    (entry) => entry.target.tab === "train" && entry.target.panel === trainPanel
  );
  return item?.label ?? "Identity";
}
