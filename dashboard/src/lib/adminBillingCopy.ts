/**
 * Super Admin billing copy. Pure: no data access and no `@/` imports, so node tests can load it
 * with --experimental-strip-types. Copy names the job, never a supplier, table, or env name.
 */

export type ChargingMode = "off" | "soft" | "hard";

/** A business waiting for a number carries a `pending:<id>` placeholder. Never show it. */
export function isPlaceholderNumber(raw: string | null | undefined): boolean {
  const value = String(raw || "").trim();
  if (!value) return true;
  if (/^pending:/i.test(value)) return true;
  return !/^\+?\d[\d\s-]{5,}$/.test(value);
}

export function numberLabel(raw: string | null | undefined): string {
  return isPlaceholderNumber(raw) ? "Waiting for a number" : String(raw).trim();
}

/** Text the Billing search may match on. A placeholder number is not searchable. */
export function searchableNumber(raw: string | null | undefined): string {
  return isPlaceholderNumber(raw) ? "" : String(raw).trim().toLowerCase();
}

export function modeName(mode: ChargingMode): string {
  if (mode === "off") return "Beta (free)";
  if (mode === "soft") return "On-demand soft";
  return "On-demand hard";
}

/**
 * The charging sheet's main button. A business already on the chosen mode has nothing to save,
 * so the button says so instead of offering to stop charging a free business.
 */
export function chargingAction(
  current: ChargingMode,
  next: ChargingMode,
): { label: string; disabled: boolean; needsConfirm: boolean } {
  if (current === next) return { label: "No change", disabled: true, needsConfirm: false };
  if (current === "off") return { label: "Start charging", disabled: false, needsConfirm: true };
  if (next === "off") return { label: "Stop charging", disabled: false, needsConfirm: false };
  return { label: `Switch to ${modeName(next)}`, disabled: false, needsConfirm: false };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EAT_MS = 3 * 60 * 60 * 1000;

function dayLabel(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `1 ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The period an assignment starts today: the 1st of this month in Nairobi, for one month or
 * twelve. Mirrors assign_tenant_package.
 */
export function periodWindow(period: "month" | "year", now: Date = new Date()): { start: string; end: string } {
  const eat = new Date(now.getTime() + EAT_MS);
  const year = eat.getUTCFullYear();
  const month = eat.getUTCMonth();
  return {
    start: dayLabel(year, month),
    end: dayLabel(year, month + (period === "year" ? 12 : 1)),
  };
}

export type PackageFacts = {
  name: string;
  minutes: number;
  sms: number;
  email: number;
};

export type PackageChange = {
  title: string;
  confirmLabel: string;
  lines: string[];
};

function count(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-KE");
}

/**
 * What Change package does today, said plainly before it happens. assign_tenant_package
 * applies at once, restarts the period on the 1st of this month, and overwrites the included
 * amounts with the new package's, which drops any minutes granted on top. Minutes already used
 * keep counting.
 */
export function packageChange(opts: {
  current: (PackageFacts & { period: "month" | "year" | null }) | null;
  next: PackageFacts;
  period: "month" | "year";
  minutesIncluded: number;
  minutesUsed: number;
  now?: Date;
}): PackageChange {
  const { current, next, period } = opts;
  const window = periodWindow(period, opts.now);
  const same = Boolean(current && current.name === next.name && current.period === period);
  const granted = current ? Math.max(0, Math.round(opts.minutesIncluded - current.minutes)) : 0;
  const used = Math.max(0, Math.round(opts.minutesUsed));

  const lines = [
    `Applies now. The period restarts and runs ${window.start} to ${window.end}.`,
    `Included becomes ${next.name}'s: ${count(next.minutes)} min, ${count(next.sms)} SMS, ${count(next.email)} email.`,
    granted > 0
      ? `Clears the ${count(granted)} granted minutes on top of ${current?.name}.`
      : "Clears any minutes granted this period.",
    used > next.minutes
      ? `${count(used)} minutes already used still count. That is more than ${next.name} includes.`
      : `${count(used)} minutes already used still count.`,
  ];

  if (!current) {
    return { title: `Assign ${next.name}?`, confirmLabel: "Assign package", lines };
  }
  if (same) {
    return { title: `Reapply ${next.name}?`, confirmLabel: "Reapply package", lines };
  }
  return { title: `Change to ${next.name}?`, confirmLabel: "Change package", lines };
}

export type BillingAuditInput = {
  action: string;
  actor: string | null;
  detail: Record<string, unknown> | null;
};

function packageText(value: unknown): string {
  if (!value || typeof value !== "object") return "None";
  const v = value as { packageName?: unknown; period?: unknown };
  const name = typeof v.packageName === "string" && v.packageName ? v.packageName : "None";
  const period = v.period === "year" ? " / year" : v.period === "month" ? " / month" : "";
  return name === "None" ? "None" : `${name}${period}`;
}

/** Second line of a History row: what changed, then why. The title and stamp come from the caller. */
export function billingAuditDetail(row: BillingAuditInput): string | null {
  const detail = row.detail || {};
  const note = [detail.note, detail.reason].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const parts: string[] = [];
  if (row.action === "assign_package") {
    parts.push(`${packageText(detail.before)} → ${packageText(detail.after)}`);
  } else if (row.action === "set_billing_mode") {
    const mode = detail.mode;
    if (mode === "off" || mode === "soft" || mode === "hard") parts.push(`Now ${modeName(mode)}`);
  } else if (row.action === "grant_package_minutes") {
    const m = detail.minutes_granted ?? detail.minutes;
    if (typeof m === "number") parts.push(`+${count(m)} min`);
  }
  if (note) parts.push(note.trim());
  return parts.length ? parts.join(" · ") : null;
}

const LEDGER_KINDS: Record<string, string> = {
  call_charge: "Call charge",
  line_rental: "Line rental",
  topup: "Balance added",
  admin_adjustment: "Balance adjusted",
  migration_credit: "Balance carried over",
  trial_credit: "Trial balance",
};

/** Charge lines stay as usage history. Name them like a receipt, not a column. */
export function ledgerKindLabel(kind: string): string {
  if (LEDGER_KINDS[kind]) return LEDGER_KINDS[kind];
  const words = String(kind || "Charge").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The error text a failed admin request should show. Never an object, never empty. */
export function requestErrorText(json: unknown, fallback = "That didn't save. Nothing changed. Try again."): string {
  const raw = json && typeof json === "object" ? (json as { error?: unknown }).error : undefined;
  if (typeof raw === "string" && raw.trim() && raw.trim() !== "[object Object]") return raw.trim();
  return fallback;
}
