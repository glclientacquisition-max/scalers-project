/**
 * Phone-wallet alert mail for the ops cron, in the @scalers/email layout.
 * The layout comes from packages/email (ops_wallet), exported as static
 * templates in opsWalletTemplates.ts. This module only picks a template
 * and fills its fields, escaped. Pure: no env reads, no network.
 *
 * The environment tag follows the wallet the notice is about, never the host:
 * prod Desk also sends the staging wallet alert, and that one says STAGING.
 */
import { OPS_WALLET_FIELDS, OPS_WALLET_TEMPLATES } from "@/lib/opsWalletTemplates";
import {
  isStagingWalletKind,
  kesLabel,
  LEGACY_WALLET_KIND,
  rearmCeilingMinor,
  STAGING_WALLET_PREFIX,
} from "@/lib/balanceAlerts";

export type WalletEnv = "production" | "staging";
export type WalletState = "low" | "empty" | "topped_up";

export type WalletReading = {
  balanceMinor: number | null;
  /** SautiKit workspace_id from GET /v1/wallet, when known. */
  workspaceId?: string | null;
  /** Thresholds in minor units, highest first. */
  thresholdsMinor: number[];
  /** Production only: what renews next and what it costs. */
  renewal?: { count: number | null; dueMinor: number | null; date: string } | null;
};

export type WalletMailContext = {
  production: WalletReading;
  staging: WalletReading;
  checkedAt: Date;
  rearmMargin: number;
};

export function isWalletKind(kind: string): boolean {
  return kind === LEGACY_WALLET_KIND || String(kind || "").startsWith(`${LEGACY_WALLET_KIND}:`);
}

export function walletEnvOf(kind: string): WalletEnv {
  return isStagingWalletKind(kind) ? "staging" : "production";
}

/** "21 Oct 2026, 18:49 EAT". */
export function eatLabel(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const v = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${v("day")} ${v("month")} ${v("year")}, ${v("hour")}:${v("minute")} EAT`;
}

/** SautiKit charges rental on the calendar 1st (about 05:00 EAT). "1 Nov". */
export function nextRenewalLabel(now: Date): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const next = new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() + 1, 1));
  return `1 ${next.toLocaleString("en-GB", { month: "short", timeZone: "UTC" })}`;
}

export function renewalRiskLine(renewal: WalletReading["renewal"]): string {
  if (!renewal) return "";
  const { count, dueMinor, date } = renewal;
  if (count != null && count > 0 && dueMinor != null) {
    return `${count} ${count === 1 ? "number renews" : "numbers renew"} on ${date}: ${kesLabel(dueMinor)} due.`;
  }
  return `Numbers renew on ${date}.`;
}

function workspaceLabel(env: WalletEnv, id: string | null | undefined): string {
  const name = env === "production" ? "Production" : "Staging";
  const short = String(id || "").trim().slice(0, 8);
  return short ? `${name} (${short})` : name;
}

function thresholdOf(kind: string): number | null {
  const last = String(kind).split(":").pop() || "";
  const n = Number(last);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function fill(template: string, values: Record<string, string>, html: boolean): string {
  let out = template;
  for (const [field, token] of Object.entries(OPS_WALLET_FIELDS)) {
    const raw = values[field] ?? "";
    out = out.split(token).join(html ? escapeHtml(raw) : raw);
  }
  return out;
}

export type WalletMail = { subject: string; text: string; html: string; env: WalletEnv; state: WalletState };

/**
 * Mail for one wallet notice, or null when the kind is not a wallet notice or
 * the balance is unknown. `recovered` picks the topped-up template.
 */
export function walletMail(kind: string, recovered: boolean, ctx: WalletMailContext): WalletMail | null {
  if (!isWalletKind(kind)) return null;
  const env = walletEnvOf(kind);
  const reading = env === "production" ? ctx.production : ctx.staging;
  if (reading.balanceMinor == null || !Number.isFinite(reading.balanceMinor)) return null;
  const thresholds = [...reading.thresholdsMinor].sort((a, b) => b - a);
  const top = thresholds[0] ?? null;
  const own = thresholdOf(kind);
  const empty = /:empty$/.test(kind);

  let state: WalletState;
  let threshold: string;
  if (recovered) {
    state = "topped_up";
    const line = own ?? top;
    threshold = line != null ? kesLabel(rearmCeilingMinor(line, ctx.rearmMargin)) : "";
  } else if (empty || reading.balanceMinor <= 0) {
    state = "empty";
    threshold = "KES 0";
  } else {
    state = "low";
    threshold = own != null ? kesLabel(own) : top != null ? kesLabel(top) : "";
  }
  const template = OPS_WALLET_TEMPLATES[`${env}:${state}`];
  if (!template) return null;
  const values: Record<string, string> = {
    workspace: workspaceLabel(env, reading.workspaceId),
    balance: kesLabel(reading.balanceMinor),
    threshold,
    checkedAt: eatLabel(ctx.checkedAt),
    risk: env === "production" ? renewalRiskLine(reading.renewal) || `Numbers renew on ${nextRenewalLabel(ctx.checkedAt)}.` : "",
    nextAlert: top != null ? kesLabel(top) : "",
  };
  return {
    env,
    state,
    subject: fill(template.subject, values, false),
    text: fill(template.text, values, false),
    html: fill(template.html, values, true),
  };
}

export { STAGING_WALLET_PREFIX };
