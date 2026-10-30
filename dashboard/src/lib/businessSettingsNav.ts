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
  | "calls"
  | "alerts"
  | "assistant-say";

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
  raw: string | undefined | null,
  panelRaw?: string | null
): BusinessSettingsTab {
  if (isTrainPanelAlias(raw)) return "train";
  // The catalogue is its own tab. Old "Add prices" / "Check prices" links sent
  // ?tab=train&panel=catalog, which fell through to Identity.
  if ((raw === "train" || !raw) && panelRaw === "catalog") return "catalog";
  if (
    raw === "catalog" ||
    raw === "train" ||
    raw === "import" ||
    raw === "test" ||
    raw === "calls" ||
    raw === "alerts" ||
    raw === "assistant-say"
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
  | { tab: "train"; panel: Exclude<SettingsPanel, "catalog"> }
  | { href: "/settings/plan" | "/settings/billing" | "/settings/areas" | "/settings/knowledge" };

export type SettingsNavItem = {
  label: string;
  /** One plain line for the Settings home list. */
  description: string;
  target: SettingsNavTarget;
};

export type SettingsNavSection = {
  id: "business" | "knowledge" | "assistant" | "people" | "billing";
  title: string;
  items: SettingsNavItem[];
};

/**
 * Settings destinations. /settings with no section is the Settings home on every width
 * (phone: the whole screen; tablet and desktop: the right pane beside the rail).
 * One header each: Business, Knowledge, Assistant, People, then Plan and billing.
 * Bulk add lives in Catalogue (Add many); old ?tab=import links redirect there. Team is People, ahead of Alerts.
 * Plan and Billing are the last section. The rail shows them to the owner and an admin.
 * Appearance is the account-menu theme cluster. It is not a settings tab.
 * URLs stay `?tab=` / `?panel=`.
 */
export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    id: "business",
    title: "Business",
    items: [
      { label: "Identity", description: "Name, what you do, greeting, voice and contacts", target: { tab: "train", panel: "identity" } },
      { label: "Hours", description: "When you are open, including holidays", target: { tab: "train", panel: "hours" } },
      { label: "Locations", description: "Where callers can find you", target: { tab: "train", panel: "locations" } },
      { label: "Service areas", description: "Which counties, towns and estates you serve", target: { href: "/settings/areas" } },
      { label: "Policies", description: "Payments, delivery, returns and other rules", target: { tab: "train", panel: "policies" } },
    ],
  },
  {
    id: "knowledge",
    title: "Knowledge",
    items: [
      // v2 Knowledge Base editor; before the v2 tables exist it sends the owner to the old tab: "catalog" screen.
      { label: "Catalogue", description: "What you sell and its prices. Add many at once", target: { href: "/settings/knowledge" } },
      { label: "FAQs", description: "Answers to the questions callers ask most", target: { tab: "train", panel: "faqs" } },
    ],
  },
  {
    id: "assistant",
    title: "Business Assistant",
    items: [
      {
        label: "What callers hear",
        description: "What callers hear before your team calls back",
        target: { tab: "assistant-say" },
      },
      { label: "Voice", description: "What it does on a call and its tools", target: { tab: "train", panel: "tools" } },
      { label: "Pronunciation", description: "Names and words it should say a certain way", target: { tab: "train", panel: "pronunciation" } },
      { label: "Test", description: "Call your line and hear it answer", target: { tab: "test" } },
      { label: "Calls & forwarding", description: "How calls reach your Business Assistant", target: { tab: "calls" } },
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
  {
    id: "billing",
    title: "Plan and billing",
    items: [
      { label: "Plan", description: "Package, minutes and seats", target: { href: "/settings/plan" } },
      { label: "Billing", description: "Invoices and notices", target: { href: "/settings/billing" } },
    ],
  },
];

/**
 * The Settings home line for an item, in the business's own words. Policies names
 * delivery and returns only for a business that sells products.
 */
export function settingsNavDescription(item: SettingsNavItem, vertical?: string | null): string {
  const target = item.target;
  if ("tab" in target && target.tab === "train" && target.panel === "policies") {
    const v = String(vertical || "").trim().toLowerCase();
    if (v === "retail") return item.description;
    if (v === "home_services") return "Payments, cancellations, guarantees and other rules";
    return "Payments, bookings, cancellations and other rules";
  }
  return item.description;
}

export function settingsNavHref(target: SettingsNavTarget): string {
  if ("href" in target) return target.href;
  return target.tab === "train"
    ? businessSettingsHref("train", target.panel)
    : businessSettingsHref(target.tab);
}

export function settingsNavItemActive(
  target: SettingsNavTarget,
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel,
  pathname?: string | null,
): boolean {
  if ("href" in target) {
    const path = pathname || "";
    return path === target.href || path.startsWith(`${target.href}/`);
  }
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
  trainPanel: SettingsPanel
): string | null {
  if (tab === "menu") return null;
  if (tab === "catalog") return "Catalogue";
  if (tab === "alerts") return "How we notify";
  if (tab === "test") return "Test";
  if (tab === "calls") return "Calls & forwarding";
  if (tab === "assistant-say") return "What callers hear";
  if (tab !== "train") return null;
  const item = settingsNavItems().find((entry) => {
    const target = entry.target;
    return "tab" in target && target.tab === "train" && target.panel === trainPanel;
  });
  return item?.label ?? "Identity";
}
