import { isMissingTableError } from "@/lib/adminErrors";
import {
  noticeBaseKind,
  parseWalletThresholdsKes,
  parseRearmMargin,
  rearmCeilingMinor,
  platformCronSignals,
  positiveNumber,
  smsSignals,
  voiceHealthKnown,
  walletSignals,
  walletThresholdsMinor,
  DEFAULT_SMS_CRITICAL_AT,
  DEFAULT_SMS_WARN_BELOW,
  DEFAULT_STAGING_WALLET_THRESHOLDS_KES,
  STAGING_WALLET_PREFIX,
  type CronSignal,
} from "@/lib/balanceAlerts";
import { isOpsMailConfigured, sendOpsMail } from "@/lib/opsMail";
import {
  alertRecipients,
  opsAlertsDryRun,
  opsAlertsStagingBlocked,
  opsMailKeepsClaim,
  runOpsAlerts,
  type AlertNotice,
  type AlertRunResult,
  type AlertStore,
} from "@/lib/opsAlertsRun";
import { gatherPlatformSignals } from "@/lib/platformOps";
import { kindLabel, opsMailSubject, parseKindFlags, DEFAULT_SAUTIKIT_WARN_MINOR } from "@/lib/platformOpsModel";
import {
  getSautikitAdminOpsKey,
  getSautikitWallet,
  isSautikitConfigured,
  listSautikitNumbers,
  normalizeSautikitApiKey,
} from "@/lib/sautikit";
import { isWalletKind, nextRenewalLabel, walletMail, type WalletMailContext, type WalletReading } from "@/lib/opsWalletEmail";
import { getSupabaseAdmin } from "@/lib/supabase";
import { readTextSmsCredit } from "@/lib/textSmsBalance";

const TABLE = "platform_ops_notices";
const LIVE = ["open", "acked"];

/**
 * Staff ops notices. Owner call alerts stay on the Voice send path
 * (templates and the one-message-per-call dispatcher). This cron does not
 * import those modules.
 *
 * Balances are read here, on the server: SautiKit wallet with the API key,
 * TextSMS getbalance with the partner key. Neither read uses the public
 * Voice health URL.
 */

function supabaseAlertStore(): AlertStore {
  const db = getSupabaseAdmin();
  return {
    async readOpenNotices() {
      const { data, error } = await db.from(TABLE).select("id, kind, status, notified_at, opened_at").in("status", LIVE);
      if (error) throw error;
      return (data || []) as AlertNotice[];
    },
    async insertOpen(kind, detail, nowIso, opts) {
      const { error } = await db.from(TABLE).insert({
        kind,
        status: "open",
        detail,
        opened_at: nowIso,
        notified_at: opts?.silent ? nowIso : null,
      });
      if (error?.code === "23505") return false;
      if (error) throw error;
      return true;
    },
    async updateDetail(id, detail) {
      const { error } = await db.from(TABLE).update({ detail }).eq("id", id);
      if (error) throw error;
    },
    async resolve(id, nowIso) {
      const { data, error } = await db
        .from(TABLE)
        .update({ status: "resolved", resolved_at: nowIso })
        .eq("id", id)
        .in("status", LIVE)
        .select("id, kind, status, notified_at");
      if (error) throw error;
      return ((data || [])[0] as AlertNotice | undefined) || null;
    },
    async claimNotified(id, nowIso) {
      const { data, error } = await db
        .from(TABLE)
        .update({ notified_at: nowIso })
        .eq("id", id)
        .is("notified_at", null)
        .select("id");
      if (error) throw error;
      return (data || []).length === 1;
    },
    async releaseClaim(id, claimedIso) {
      const { error } = await db.from(TABLE).update({ notified_at: null }).eq("id", id).eq("notified_at", claimedIso);
      if (error) console.error("[ops-alerts] release claim", error.message);
    },
  };
}

async function loadAlertSettings(): Promise<{
  recipients: string[];
  kinds: Record<string, boolean>;
  sautikitWarnMinor: number;
}> {
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("platform_ops_settings")
    .select("emails, people, kinds, sautikit_warn_minor")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (isMissingTableError(error)) {
      return { recipients: [], kinds: parseKindFlags(null), sautikitWarnMinor: DEFAULT_SAUTIKIT_WARN_MINOR };
    }
    throw error;
  }
  const warn = Number(data?.sautikit_warn_minor);
  return {
    recipients: alertRecipients(data),
    kinds: parseKindFlags(data?.kinds),
    sautikitWarnMinor: Number.isFinite(warn) && warn > 0 ? warn : DEFAULT_SAUTIKIT_WARN_MINOR,
  };
}

function simulateMinor(name: "wallet" | "sms"): number | null {
  if (process.env.VERCEL_ENV === "production") return null;
  const raw =
    name === "wallet" ? process.env.OPS_ALERTS_SIMULATE_WALLET_MINOR : process.env.OPS_ALERTS_SIMULATE_SMS_CREDIT;
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

type WalletRead = { minor: number | null; workspaceId: string | null };

/** Authenticated wallet read. Unknown on a missing key, a hidden balance, or an error. */
async function readWallet(): Promise<WalletRead> {
  const simulated = simulateMinor("wallet");
  if (simulated != null) return { minor: simulated, workspaceId: null };
  if (!isSautikitConfigured()) return { minor: null, workspaceId: null };
  try {
    const wallet = await getSautikitWallet();
    const minor = Number(wallet?.balance_minor);
    return { minor: Number.isFinite(minor) ? minor : null, workspaceId: wallet?.workspace_id || null };
  } catch {
    console.warn("[ops-alerts] phone wallet balance unread");
    return { minor: null, workspaceId: null };
  }
}

/**
 * What renews on the 1st, for the production low-balance mail. Read only.
 * Tries SAUTIKIT_ADMIN_OPS_KEY, then SAUTIKIT_API_KEY; either may lack numbers.read,
 * in which case the mail says only the date.
 */
async function readRenewal(now: Date): Promise<NonNullable<WalletReading["renewal"]>> {
  const date = nextRenewalLabel(now);
  const keys = [normalizeSautikitApiKey(getSautikitAdminOpsKey()), ""];
  for (const key of keys) {
    if (key === "" && !isSautikitConfigured()) break;
    try {
      const numbers = await listSautikitNumbers(key || undefined);
      const held = numbers.filter((n) => !/releas|cancel/i.test(String(n.status || "")));
      const dueMinor = held.reduce((sum, n) => sum + (Number(n.monthly_retail_minor) || 0), 0);
      return { count: held.length, dueMinor, date };
    } catch {
      // Scope denied or unreachable: try the next key, then fall back to the date alone.
    }
  }
  return { count: null, dueMinor: null, date };
}

/**
 * Staging phone wallet, read from prod Desk because staging Desk never mails.
 * SAUTIKIT_STAGING_WALLET_KEY: a wallet.read-only key for the staging workspace.
 * Unset means unknown: staging notices hold and nothing opens.
 */
async function readStagingWallet(): Promise<WalletRead> {
  const key = normalizeSautikitApiKey(process.env.SAUTIKIT_STAGING_WALLET_KEY);
  if (!key) return { minor: null, workspaceId: null };
  try {
    const wallet = await getSautikitWallet(key);
    const minor = Number(wallet?.balance_minor);
    return { minor: Number.isFinite(minor) ? minor : null, workspaceId: wallet?.workspace_id || null };
  } catch {
    console.warn("[ops-alerts] staging phone wallet balance unread");
    return { minor: null, workspaceId: null };
  }
}

async function readSmsCredit(): Promise<{ balance: number | null; exhausted: boolean }> {
  const simulated = simulateMinor("sms");
  if (simulated != null) return { balance: simulated, exhausted: simulated <= 0 };
  return readTextSmsCredit();
}

/**
 * Wallet notices (production and staging) use the @scalers/email ops_wallet layout,
 * tagged by the wallet they are about. Everything else stays plain text.
 */
export function composeNotice(
  kind: string,
  recovered: boolean,
  detail: string,
  wallet?: WalletMailContext | null,
): { subject: string; text: string; html?: string } {
  if (wallet && isWalletKind(kind)) {
    const mail = walletMail(kind, recovered, wallet);
    if (mail) return { subject: mail.subject, text: mail.text, html: mail.html };
  }
  const label = kindLabel(kind);
  // Wallet notices carry their own top-up line ("Phone wallet topped up: KES 600, back above KES 550").
  const walletRecovery = recovered && noticeBaseKind(kind) === "sautikit_low" && detail;
  const line = walletRecovery ? detail : recovered ? `${label} recovered` : detail || label;
  return {
    subject: opsMailSubject(kind, recovered),
    text: `${line}\n\nOpen Platform in Admin.`,
  };
}

/**
 * One scheduled pass. Called only from GET /api/cron/ops-alerts, behind CRON_SECRET.
 * Railway Voice calls that route. This module does not register a Vercel cron.
 * OPS_ALERTS_DRY_RUN unset, or anything but false: notices still open and resolve, no mail.
 * Staging (staging Supabase, the staging Vercel project, or a scalers-staging host)
 * never mails, even when dry run is off.
 */
export async function runScheduledOpsAlerts(now: Date = new Date()): Promise<AlertRunResult> {
  const staging = opsAlertsStagingBlocked(process.env);
  const dryRun = staging || opsAlertsDryRun(process.env.OPS_ALERTS_DRY_RUN) || !isOpsMailConfigured();
  const probe = await getSupabaseAdmin().from(TABLE).select("id", { count: "exact", head: true });
  if (probe.error) {
    if (!isMissingTableError(probe.error)) throw probe.error;
    console.warn("[ops-alerts] platform_ops_notices missing; skipping");
    return { dryRun, recipients: 0, opened: [], resolved: [], sent: [], wouldSend: [], quieted: [], failed: [] };
  }

  const store = supabaseAlertStore();
  const [gathered, settings, open, prodWallet, stagingWallet, sms] = await Promise.all([
    gatherPlatformSignals(),
    loadAlertSettings(),
    store.readOpenNotices(),
    readWallet(),
    readStagingWallet(),
    readSmsCredit(),
  ]);
  const openNotices = open.filter((notice) => notice.status === "open" || notice.status === "acked");
  const voice = gathered.voice.status === "ok" ? gathered.voice.payload : null;
  const known = {
    ...voiceHealthKnown(
      gathered.voice.status === "ok"
        ? { status: "ok", soniox: voice?.soniox, gemini: voice?.gemini }
        : { status: gathered.voice.status === "invalid" ? "invalid" : "unreachable" },
    ),
    phone: gathered.phoneKnown,
  };
  const thresholds = walletThresholdsMinor(process.env.OPS_WALLET_ALERT_THRESHOLDS_KES, settings.sautikitWarnMinor);
  const stagingThresholds = parseWalletThresholdsKes(
    process.env.OPS_STAGING_WALLET_ALERT_THRESHOLDS_KES,
    DEFAULT_STAGING_WALLET_THRESHOLDS_KES,
  );
  const rearmMargin = parseRearmMargin(process.env.OPS_ALERTS_REARM_MARGIN);
  const walletMinor = prodWallet.minor;
  const stagingWalletMinor = stagingWallet.minor;
  // The renewal line is only needed when a production low mail can go out.
  const topMinor = Math.max(0, ...thresholds);
  const renewal =
    walletMinor != null && topMinor > 0 && walletMinor <= rearmCeilingMinor(topMinor, rearmMargin)
      ? await readRenewal(now)
      : null;
  const walletContext: WalletMailContext = {
    production: { balanceMinor: walletMinor, workspaceId: prodWallet.workspaceId, thresholdsMinor: thresholds, renewal },
    staging: { balanceMinor: stagingWalletMinor, workspaceId: stagingWallet.workspaceId, thresholdsMinor: stagingThresholds },
    checkedAt: now,
    rearmMargin,
  };
  const signals: CronSignal[] = [
    ...platformCronSignals(gathered.signals, known),
    ...walletSignals({
      balanceMinor: walletMinor,
      thresholdsMinor: thresholds,
      openNotices,
      rearmMargin,
    }),
    ...walletSignals({
      balanceMinor: stagingWalletMinor,
      thresholdsMinor: stagingThresholds,
      openNotices,
      rearmMargin,
      kindPrefix: STAGING_WALLET_PREFIX,
    }),
    ...smsSignals({
      balance: sms.balance,
      exhausted: sms.exhausted,
      warnBelow: positiveNumber(process.env.OPS_SMS_CREDIT_WARN_BELOW, DEFAULT_SMS_WARN_BELOW),
      criticalAt: positiveNumber(process.env.OPS_SMS_CREDIT_CRITICAL_AT, DEFAULT_SMS_CRITICAL_AT),
      openNotices,
    }),
  ];

  const result = await runOpsAlerts({
    store,
    signals,
    kinds: settings.kinds,
    recipients: settings.recipients,
    dryRun,
    now,
    staleMs: positiveNumber(process.env.OPS_ALERTS_STALE_HOURS, 6) * 60 * 60 * 1000,
    compose: (kind, recovered, detail) => composeNotice(kind, recovered, detail, walletContext),
    send: async (mail) => {
      if (staging) throw new Error("staging");
      const out = await sendOpsMail({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        ledger: { kind: `platform_ops_${noticeBaseKind(mail.kind)}`, key: mail.ledgerKey },
      });
      if (!opsMailKeepsClaim(out.sent, out.skipped)) throw new Error(out.skipped || "not sent");
    },
  });
  if (result.wouldSend.length) {
    console.info("[ops-alerts] dry run, would send", result.wouldSend.map((row) => row.kind).join(","));
  }
  return result;
}
