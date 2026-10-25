/**
 * One business pane for every entry point (locked 23 Oct 2026, t179u).
 * Fixed section order; the entry point only picks which section is in view first.
 */
export const BUSINESS_PANE_SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "usage", label: "Usage" },
  { id: "money", label: "Money" },
  { id: "number", label: "Number" },
  { id: "calls", label: "Calls & quality" },
  { id: "history", label: "History" },
] as const;

export type BusinessPaneSection = (typeof BUSINESS_PANE_SECTIONS)[number]["id"];

export function parsePaneSection(raw: string | null | undefined): BusinessPaneSection {
  const hit = BUSINESS_PANE_SECTIONS.find((s) => s.id === raw);
  return hit ? hit.id : "summary";
}

/** Where a click came from decides the first section in view. */
export type PaneEntry = "businesses" | "billing" | "invoices" | "payments" | "quality" | "insights" | "numbers" | "overview" | "search" | "usage";
export function sectionForEntry(entry: PaneEntry): BusinessPaneSection {
  if (entry === "billing" || entry === "invoices" || entry === "payments") return "money";
  if (entry === "quality" || entry === "insights") return "calls";
  if (entry === "numbers") return "number";
  if (entry === "usage") return "usage";
  return "summary";
}

/** The one URL for "open this business". */
export function businessPaneHref(id: string, section: BusinessPaneSection = "summary"): string {
  const q = `pane=${encodeURIComponent(id)}`;
  return `/admin/businesses?${q}${section === "summary" ? "" : `&section=${section}`}`;
}

/** Old business URLs → the pane. Null when the path is not a business page. */
export function businessPaneRedirect(pathname: string): string | null {
  const biz = /^\/admin\/businesses\/([^/?#]+)\/?$/.exec(pathname);
  if (biz) return businessPaneHref(decodeURIComponent(biz[1]));
  const bill = /^\/admin\/billing\/([^/?#]+)\/?$/.exec(pathname);
  if (bill && !["invoices", "payments", "packages", "catalog", "collections"].includes(bill[1])) {
    return businessPaneHref(decodeURIComponent(bill[1]), "money");
  }
  return null;
}

export type PaneUsage = {
  packageName: string | null;
  period: "month" | "year" | null;
  periodEndLabel: string | null;
  minutesIncluded: number;
  minutesUsed: number;
  minutesRemaining: number;
  onDemand: boolean;
  statusLabel: string;
};
export type PaneMoney = {
  /** Open invoices not void/draft. */
  openCount: number;
  overdueCount: number;
  balanceCents: number;
  lastPaidAt: string | null;
  lastInvoice: { id: string; number: string; status: string } | null;
};
export type PaneAudit = { id: string; when: string; action: string; actor: string };
export type PaneCallRow = { id: string; created_at: string; duration_seconds: number | null; primary_intent: string | null; status: string | null };
export type BusinessPaneData = {
  usage: PaneUsage | null;
  money: PaneMoney | null;
  calls: PaneCallRow[] | null;
  audit: PaneAudit[] | null;
};

/** Minutes used as a share of included; null with no package minutes. */
export function usedShare(u: PaneUsage | null): number | null {
  if (!u || !u.minutesIncluded) return null;
  return Math.min(999, Math.round((u.minutesUsed / u.minutesIncluded) * 100));
}

const ACTIONS: Record<string, string> = {
  assign_package: "Package changed",
  unassign_package: "Package removed",
  grant_minutes: "Minutes granted",
  set_billing_mode: "Charging changed",
  archive: "Archived",
  unarchive: "Unarchived",
  suspend: "Line suspended",
  restore: "Line restored",
  release_number: "Number released",
  assign_number: "Number assigned",
};
/** Plain label for an ops_audit_log action; unknown actions read as words, never raw keys. */
export function auditLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  const words = action.replace(/[_.:-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Change";
}
