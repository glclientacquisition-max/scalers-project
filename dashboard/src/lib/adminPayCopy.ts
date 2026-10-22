/**
 * Super Admin payment screens. Pure labels. No env values, no provider calls.
 */

import { actionLabel, eatStamp } from "./adminActivityModel";

export type ReviewTarget = {
  businessId: string;
  businessName?: string | null;
  providerRef: string;
  getKes: string;
  seenKes: string;
  reason: string;
  invoiceId: string | null;
};

export type AttentionKind = "checkout_review" | "unmatched" | "partial" | "retry" | "held";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  title: string;
  preview: string;
  when: string;
  href: string;
  review: ReviewTarget | null;
};

export type InvoiceTone = "neutral" | "attention" | "ok";

export type AdminInvoiceListRow = {
  id: string;
  number: string;
  businessId: string;
  businessName: string;
  status: string;
  statusLabel: string;
  tone: InvoiceTone;
  total: string;
  paid: string;
  due: string;
  created: string;
};

export type AdminInvoiceLine = {
  id: string;
  title: string;
  preview: string;
};

export type AdminInvoiceEvent = {
  id: string;
  title: string;
  preview: string;
  when: string;
};

export type AdminInvoiceDetail = {
  id: string;
  number: string;
  businessId: string;
  businessName: string;
  statusLabel: string;
  tone: InvoiceTone;
  total: string;
  paid: string;
  due: string;
  created: string;
  lines: AdminInvoiceLine[];
  payments: AdminInvoiceEvent[];
  attempts: AdminInvoiceEvent[];
  receipts: AdminInvoiceEvent[];
  audit: AdminInvoiceEvent[];
  warning: string | null;
};

export type HostingSwitches = {
  modeOn: boolean;
  liveMasterOn: boolean;
  noticesOn: boolean;
  planChangeOn: boolean;
};

export type DbFlagSwitches = {
  available: boolean;
  packageEditorEnabled: boolean;
  signupTrialEnabled: boolean;
};

export type BachsStatusView = {
  modeLabel: string;
  liveSwitch: "On" | "Off";
  keySet: "Yes" | "No";
  webhookSecretSet: "Yes" | "No";
  /** P20 applied: payment switches are stored on this database and editable in Admin. */
  runtimeControlsAvailable: boolean;
  hosting: HostingSwitches;
  dbFlags: DbFlagSwitches;
  liveSummary: string;
  liveRows: { id: string; name: string; preview: string }[];
  lastWebhook: string;
  webhooks24h: string;
  reconcileAvailable: boolean;
  reconcile: { label: string; count: number }[];
};

export function kshLabel(raw: unknown): string {
  if (raw == null || raw === "") return "KSh 0";
  const text = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return "KSh 0";
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace(/^-/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const tail = (frac + "00").slice(0, 2);
  const body = tail === "00" ? grouped : `${grouped}.${tail}`;
  return `${negative ? "-" : ""}KSh ${body}`;
}

export function reviewReasonFromRaw(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "collected_total_short";
  const row = raw as { reason?: unknown; review_kind?: unknown };
  const reason = typeof row.reason === "string" ? row.reason.trim() : "";
  if (reason) return reason;
  if (row.review_kind === "missing_identity") return "collected_identity_missing";
  if (row.review_kind === "decrease") return "collected_total_decreased";
  return "collected_total_short";
}

export function reviewTitle(reason: string): string {
  if (reason === "collected_identity_missing") return "Collected amount has no receipt";
  if (reason === "collected_total_decreased") return "Collected total went down";
  if (reason === "collected_total_short") return "Collected total is short";
  return "Checkout total";
}

export function reviewPreview(review: { getKes: string; seenKes: string }, businessName?: string | null): string {
  const reading = `Reading KSh ${review.getKes}. Books show KSh ${review.seenKes}.`;
  return businessName ? `${businessName} · ${reading}` : reading;
}

export function invoiceStatusLabel(status: string): string {
  if (status === "draft") return "Draft";
  if (status === "open") return "Open";
  if (status === "paid") return "Paid";
  if (status === "void") return "Void";
  if (status === "uncollectible") return "Uncollectible";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Invoice";
}

export function invoiceTone(status: string, dueAt: string | null, now = Date.now()): InvoiceTone {
  if (status === "paid") return "ok";
  if (status === "uncollectible") return "attention";
  if (status === "open" && dueAt) {
    const due = new Date(dueAt).getTime();
    if (Number.isFinite(due) && due < now) return "attention";
  }
  return "neutral";
}

export function invoiceNumberLabel(number: string | null | undefined): string {
  const value = String(number || "").trim();
  return value || "Draft";
}

export function dueLabel(dueAt: string | null | undefined): string {
  if (!dueAt) return "No due date";
  const stamp = eatStamp(dueAt);
  return stamp ? `Due ${stamp}` : "No due date";
}

export function matchStatusLabel(status: string): string {
  if (status === "matched") return "Matched";
  if (status === "partial") return "Partial";
  if (status === "over") return "Over";
  if (status === "unmatched") return "Unmatched";
  if (status === "issue") return "Needs a check";
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : "Payment";
}

export function attemptTitle(status: string, held: boolean): string {
  if (held) return "Checkout held";
  if (status === "pending" || status === "pending_unattached") return "Checkout pending";
  if (status === "succeeded") return "Checkout collected";
  if (status === "cancelled" || status === "superseded") return "Checkout cancelled";
  if (status === "issue") return "Checkout needs a check";
  return "Checkout";
}

export function methodLabel(method: string | null | undefined): string {
  const value = String(method || "").trim();
  const lower = value.toLowerCase();
  if (!value) return "Payment";
  if (lower === "mpesa" || lower === "m-pesa") return "M-Pesa";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function allowlistCount(raw: string | null | undefined): { all: boolean; count: number } {
  const text = String(raw ?? "").trim();
  if (!text) return { all: false, count: 0 };
  if (text === "*") return { all: true, count: 0 };
  const count = text.split(",").map((part) => part.trim()).filter(Boolean).length;
  return { all: false, count };
}

export function bachsStatusFromEnv(env: {
  mode?: string | null;
  liveAllowed?: string | null;
  key?: string | null;
  webhookSecret?: string | null;
}): { mode: "off" | "sandbox" | "live" | "unknown"; liveSwitch: "On" | "Off"; keySet: "Yes" | "No"; webhookSecretSet: "Yes" | "No" } {
  const modeRaw = String(env.mode ?? "off").trim().toLowerCase();
  const mode = modeRaw === "sandbox" || modeRaw === "live"
    ? modeRaw
    : modeRaw === "" || modeRaw === "off" || modeRaw === "mock"
      ? "off"
      : "unknown";
  const liveSwitch = String(env.liveAllowed || "").trim().toLowerCase() === "true" ? "On" : "Off";
  return {
    mode,
    liveSwitch,
    keySet: String(env.key || "").trim() ? "Yes" : "No",
    webhookSecretSet: String(env.webhookSecret || "").trim() ? "Yes" : "No",
  };
}

/** Locked hosting switches. Names here are not environment variable names. */
export function hostingSwitches(env: {
  mode?: string | null;
  liveAllowed?: string | null;
  noticesSend?: string | null;
  planChange?: string | null;
}): HostingSwitches {
  const parsed = bachsStatusFromEnv({ mode: env.mode, liveAllowed: env.liveAllowed });
  return {
    modeOn: parsed.mode === "sandbox" || parsed.mode === "live",
    liveMasterOn: parsed.liveSwitch === "On",
    noticesOn: String(env.noticesSend ?? "").trim().toLowerCase() === "on",
    planChangeOn: String(env.planChange ?? "").trim() === "on",
  };
}

/** Why this business cannot take a live payment. Null when it can. */
export function livePayBlock(input: {
  modeLive: boolean;
  liveMasterOn: boolean;
  tenantEnabled: boolean;
}): string | null {
  if (!input.modeLive || !input.liveMasterOn) return "Hosting switch is off";
  if (!input.tenantEnabled) return "Not enabled";
  return null;
}

export function bachsModeLabel(mode: "off" | "sandbox" | "live" | "unknown"): string {
  if (mode === "sandbox") return "Sandbox";
  if (mode === "live") return "Live";
  if (mode === "unknown") return "Unknown";
  return "Off";
}

export function reconcileLabel(kind: string): string {
  if (kind === "pending_timeout") return "Pending too long";
  if (kind === "status_disagreement") return "Status mismatch";
  if (kind === "issue") return "Needs a check";
  if (kind === "overpaid") return "Overpaid";
  if (kind === "credited_cancelled") return "Credited after cancel";
  if (kind === "provider_disagreement") return "Provider mismatch";
  return kind ? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, " ") : "Other";
}

export function reconcileCounts(rows: { kind?: string | null }[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const kind = String(row.kind || "other");
    counts.set(kind, (counts.get(kind) || 0) + 1);
  }
  return [...counts.entries()].map(([kind, count]) => ({ label: reconcileLabel(kind), count }));
}

export function auditPreview(actor: string | null, detail: Record<string, unknown> | null): string {
  const bits: string[] = [];
  if (actor) bits.push(actor);
  const choice = detail && typeof detail.choice === "string" ? detail.choice : "";
  if (choice === "book") bits.push("Booked collected amount");
  if (choice === "nothing") bits.push("Nothing collected");
  const reason = detail && typeof detail.reason === "string" ? detail.reason.trim() : "";
  if (reason) bits.push(reason);
  return bits.join(" · ");
}

export function auditTitle(action: string): string {
  return actionLabel(action);
}

export function shopMoneyHref(businessId: string): string {
  return `/admin/businesses/${businessId}?money=1`;
}

export function invoiceHref(invoiceId: string): string {
  return `/admin/billing/invoices/${invoiceId}`;
}
