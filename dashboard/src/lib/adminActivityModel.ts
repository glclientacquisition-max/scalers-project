/**
 * Super Admin Activity: pure shaping of ops_audit_log rows. No data access, no `@/` imports.
 * Copy names the job, never a supplier, table, or env name.
 */

export type ActivityRow = {
  id: string;
  created_at: string;
  actor: string;
  action: string;
  tenant_id: string | null;
  amount_kes: number | null;
  detail: Record<string, unknown> | null;
};

const ACTIONS: Record<string, string> = {
  archive_business: "Archived business",
  restore_business: "Restored business",
  delete_business: "Deleted business for good",
  release_number: "Released number",
  assign_number: "Assigned number",
  add_number: "Added number to pool",
  buy_number: "Bought number",
  sync_numbers: "Synced numbers",
  assign_package: "Changed package",
  save_package: "Edited package",
  save_rates: "Changed rates",
  grant_package_minutes: "Granted minutes",
  set_billing_mode: "Changed charging",
  waive_overage: "Waived overage",
  save_voice: "Saved voice",
  set_default_voice: "Set default voice",
  set_voice_active: "Turned voice on or off",
  delete_voice: "Removed voice",
  save_alert_settings: "Changed alert settings",
  test_alert_mail: "Sent test alert",
  prepare_mail_domain: "Set up alert mail",
  verify_mail_domain: "Checked alert mail",
  ack_notice: "Acknowledged notice",
};

export function actionLabel(action: string): string {
  if (ACTIONS[action]) return ACTIONS[action];
  const words = String(action || "Admin action").replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const ACTIVITY_ACTIONS = Object.keys(ACTIONS);

const EAT_MS = 3 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Oct 13:05" in East Africa time. */
export function eatStamp(iso: string): string {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return "";
  const d = new Date(at + EAT_MS);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${hh}:${mm}`;
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" || typeof value === "string") return String(value);
  if (Array.isArray(value)) return value.length ? value.map(text).join(", ") : "None";
  return JSON.stringify(value);
}

function label(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type ChangeLine = { field: string; before: string; after: string };

/** Field-by-field before and after. Unchanged fields drop out. A whole value that appeared or vanished is one line. */
export function changeLines(before: unknown, after: unknown): ChangeLine[] {
  const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
  if (!isObj(before) && !isObj(after)) {
    if (before === undefined && after === undefined) return [];
    const b = text(before);
    const a = text(after);
    return b === a ? [] : [{ field: "Value", before: b, after: a }];
  }
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  const lines: ChangeLine[] = [];
  for (const key of keys) {
    const was = text(b[key]);
    const now = text(a[key]);
    if (was !== now) lines.push({ field: label(key), before: was, after: now });
  }
  return lines;
}

export type ActivityItem = {
  id: string;
  when: string;
  title: string;
  business: string | null;
  businessId: string | null;
  actor: string;
  reason: string | null;
  preview: string;
  changes: ChangeLine[];
};

export function activityItem(row: ActivityRow, names: Map<string, string>): ActivityItem {
  const detail = row.detail || {};
  // A deleted business leaves tenant_id null (ON DELETE SET NULL); its name stays in detail.
  const savedName = typeof detail.business_name === "string" && detail.business_name.trim() ? detail.business_name.trim() : "";
  const business = row.tenant_id
    ? names.get(row.tenant_id) || savedName || "Deleted business"
    : savedName || null;
  const reason = typeof detail.reason === "string" && detail.reason.trim() ? detail.reason.trim() : null;
  const note = typeof detail.note === "string" && detail.note.trim() ? detail.note.trim() : null;
  const hasDiff = "before" in detail || "after" in detail;
  const changes = hasDiff ? changeLines(detail.before, detail.after) : [];
  if (!hasDiff && row.amount_kes != null) changes.push({ field: "Amount", before: "", after: `KES ${row.amount_kes}` });
  const actor = String(row.actor || "").trim() || "Unknown";
  return {
    id: row.id,
    when: eatStamp(row.created_at),
    title: actionLabel(row.action),
    business,
    businessId: row.tenant_id,
    actor,
    reason: reason || note,
    preview: [business, actor, reason || note].filter(Boolean).join(" · "),
    changes,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Query filters. Anything malformed is dropped, never passed to the database. */
export function parseActivityFilters(params: { business?: string; actor?: string }): {
  business: string | null;
  actor: string | null;
} {
  const business = String(params.business || "").trim();
  const actor = String(params.actor || "").trim();
  return {
    business: UUID.test(business) ? business.toLowerCase() : null,
    actor: actor && actor.length <= 64 && !/[\u0000-\u001f]/.test(actor) ? actor : null,
  };
}

export function activityHref(filters: { business?: string | null; actor?: string | null }): string {
  const q = new URLSearchParams();
  if (filters.business) q.set("business", filters.business);
  if (filters.actor) q.set("actor", filters.actor);
  const s = q.toString();
  return s ? `/admin/activity?${s}` : "/admin/activity";
}
