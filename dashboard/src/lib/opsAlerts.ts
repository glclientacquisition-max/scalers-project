import { isMissingTableError } from "@/lib/adminErrors";
import {
  noticeBaseKind,
  parseRearmMargin,
  platformCronSignals,
  positiveNumber,
  smsSignals,
  voiceHealthKnown,
  walletSignals,
  walletThresholdsMinor,
  DEFAULT_SMS_CRITICAL_AT,
  DEFAULT_SMS_WARN_BELOW,
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
import { getSautikitWallet, isSautikitConfigured } from "@/lib/sautikit";
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

/** Authenticated wallet read. Unknown on a missing key, a hidden balance, or an error. */
async function readWalletMinor(): Promise<number | null> {
  const simulated = simulateMinor("wallet");
  if (simulated != null) return simulated;
  if (!isSautikitConfigured()) return null;
  try {
    const wallet = await getSautikitWallet();
    const minor = Number(wallet?.balance_minor);
    return Number.isFinite(minor) ? minor : null;
  } catch {
    console.warn("[ops-alerts] phone wallet balance unread");
    return null;
  }
}

async function readSmsCredit(): Promise<{ balance: number | null; exhausted: boolean }> {
  const simulated = simulateMinor("sms");
  if (simulated != null) return { balance: simulated, exhausted: simulated <= 0 };
  return readTextSmsCredit();
}

function composeNotice(kind: string, recovered: boolean, detail: string): { subject: string; text: string } {
  const label = kindLabel(kind);
  return {
    subject: opsMailSubject(kind, recovered),
    text: `${recovered ? `${label} recovered` : detail || label}\n\nOpen Platform in Admin.`,
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
  const [gathered, settings, open, walletMinor, sms] = await Promise.all([
    gatherPlatformSignals(),
    loadAlertSettings(),
    store.readOpenNotices(),
    readWalletMinor(),
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
  const signals: CronSignal[] = [
    ...platformCronSignals(gathered.signals, known),
    ...walletSignals({
      balanceMinor: walletMinor,
      thresholdsMinor: thresholds,
      openNotices,
      rearmMargin: parseRearmMargin(process.env.OPS_ALERTS_REARM_MARGIN),
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
    compose: composeNotice,
    send: async (mail) => {
      if (staging) throw new Error("staging");
      const out = await sendOpsMail({
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
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
