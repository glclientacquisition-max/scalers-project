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

/**
 * Settings sections live at `/settings/[section]`. One slug per destination.
 * Old `?tab=` / `?panel=` links get a 308 to these paths (see `legacySettingsRedirect`).
 * `/settings/plan` and `/settings/billing` are their own static routes and are not slugs here.
 */
export type SettingsSection =
  | "identity"
  | "hours"
  | "locations"
  | "policies"
  | "catalogue"
  | "import"
  | "faqs"
  | "assistant-say"
  | "voice"
  | "pronunciation"
  | "test"
  | "calls"
  | "team"
  | "notify";

type SectionView = { tab: Exclude<BusinessSettingsTab, "menu">; trainPanel: SettingsPanel };

const SECTION_VIEWS: Record<SettingsSection, SectionView> = {
  identity: { tab: "train", trainPanel: "identity" },
  hours: { tab: "train", trainPanel: "hours" },
  locations: { tab: "train", trainPanel: "locations" },
  policies: { tab: "train", trainPanel: "policies" },
  catalogue: { tab: "catalog", trainPanel: "identity" },
  import: { tab: "import", trainPanel: "identity" },
  faqs: { tab: "train", trainPanel: "faqs" },
  "assistant-say": { tab: "assistant-say", trainPanel: "identity" },
  voice: { tab: "train", trainPanel: "tools" },
  pronunciation: { tab: "train", trainPanel: "pronunciation" },
  test: { tab: "test", trainPanel: "identity" },
  calls: { tab: "calls", trainPanel: "identity" },
  team: { tab: "train", trainPanel: "team" },
  notify: { tab: "alerts", trainPanel: "identity" },
};

export const SETTINGS_SECTIONS = Object.keys(SECTION_VIEWS) as SettingsSection[];

/** `/settings/[section]` slug to the tab and panel the existing shell renders. Unknown slug: null. */
export function parseSettingsSection(raw: string | undefined | null): SectionView | null {
  const key = String(raw || "");
  return Object.prototype.hasOwnProperty.call(SECTION_VIEWS, key)
    ? SECTION_VIEWS[key as SettingsSection]
    : null;
}

/** Tab and panel to its slug. The Settings home (`menu`) has none. */
export function settingsSectionSlug(tab: BusinessSettingsTab, panel?: SettingsPanel | null): SettingsSection | null {
  if (tab === "menu") return null;
  if (tab === "train") {
    if (panel === "catalog") return "catalogue";
    const p = panel ?? "identity";
    return p === "tools" ? "voice" : p;
  }
  if (tab === "catalog") return "catalogue";
  if (tab === "alerts") return "notify";
  return tab;
}

export function businessSettingsHref(tab: BusinessSettingsTab, panel?: SettingsPanel) {
  const slug = settingsSectionSlug(tab, panel);
  return slug ? `/settings/${slug}` : "/settings";
}

/**
 * Old bookmark or link: `/settings?tab=..&panel=..` to `/settings/[section]`.
 * Other query params (Team paging: members, invites) ride along. Returns null when there is
 * nothing to redirect (no `tab` or `panel`), so plain `/settings` stays the Settings home.
 */
export function legacySettingsRedirect(search: string | URLSearchParams | null | undefined): string | null {
  const params = new URLSearchParams(typeof search === "string" ? search.replace(/^\?/, "") : search ?? undefined);
  if (!params.has("tab") && !params.has("panel")) return null;
  const tabRaw = params.get("tab");
  const panelRaw = params.get("panel");
  const tab = parseBusinessSettingsTab(tabRaw, panelRaw);
  const panel = parseBusinessSettingsPanel(panelRaw, tabRaw);
  params.delete("tab");
  params.delete("panel");
  const rest = params.toString();
  const path = businessSettingsHref(tab, panel);
  return rest ? `${path}?${rest}` : path;
}

/** Sidebar target. Same tabs and panels. Grouped by owner job. */
export type SettingsNavTarget =
  | { tab: Exclude<BusinessSettingsTab, "train" | "menu"> }
  | { tab: "train"; panel: Exclude<SettingsPanel, "catalog"> }
  | { href: "/settings/plan" | "/settings/billing" };

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
 * Import sits directly under Catalog. Team is People, ahead of Alerts.
 * Plan and Billing are the last section. The rail shows them to the owner and an admin.
 * Appearance is the account-menu theme cluster. It is not a settings tab.
 * URLs are `/settings/[section]`; old `?tab=` / `?panel=` links redirect.
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
    title: "Business Assistant",
    items: [
      {
        label: "What it will say",
        description: "What callers hear before your team calls back",
        target: { tab: "assistant-say" },
      },
      { label: "Voice", description: "How your Business Assistant sounds", target: { tab: "train", panel: "tools" } },
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
      ? "Import catalogue"
      : "Import knowledge";
  }
  if (tab === "test") return "Test";
  if (tab === "calls") return "Calls & forwarding";
  if (tab === "assistant-say") return "What your Business Assistant will say";
  if (tab !== "train") return null;
  const item = settingsNavItems().find((entry) => {
    const target = entry.target;
    return "tab" in target && target.tab === "train" && target.panel === trainPanel;
  });
  return item?.label ?? "Identity";
}
