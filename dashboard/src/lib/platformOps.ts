import { adminErrorParts, isMissingTableError } from "@/lib/adminErrors";
import { listDidPool, listPendingTenants } from "@/lib/didPool";
import { sendOpsMail, isOpsMailConfigured } from "@/lib/opsMail";
import {
  defaultOpsSettings,
  deriveOpsSignals,
  deriveStatusStrip,
  emailsFromPeople,
  infraFromEnv,
  kindLabel,
  opsMailSubject,
  parseKindFlags,
  parseOpsEmails,
  parsePeople,
  reconcileNotices,
  type OpsKindFlags,
  type OpsNotice,
  type OpsNoticeKind,
  type OpsSettings,
  type OpsSignal,
} from "@/lib/platformOpsModel";
import {
  derivePhoneLineHealth,
  deriveReasoningHealth,
  deriveSpeechHealth,
  type PhoneLineTelecomInput,
} from "@/lib/platformRunBoardModel";
import { fetchVoiceHealthz } from "@/lib/platformVoiceHealth";
import { getSautikitWallet, isSautikitConfigured, listSautikitNumbers } from "@/lib/sautikit";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/adminGuard";

function envEmails(): string[] {
  return parseOpsEmails(
    process.env.SCALERS_OPS_ALERT_EMAILS || process.env.SCALERS_OPS_ALERT_EMAIL || "",
  );
}

/**
 * Supabase returns plain { message, code } objects (not Error instances), so read
 * the fields instead of `instanceof Error` — otherwise PGRST205 / 42P01 rethrow.
 */
function isMissingTable(err: unknown): boolean {
  if (isMissingTableError(err)) return true;
  return /platform_ops_|schema cache/i.test(adminErrorParts(err).message);
}

function warnMissingOpsTable(table: string, err: unknown): void {
  const { message, code } = adminErrorParts(err);
  console.warn(`[admin:platform-ops] ${table} unavailable, using fallback: ${message}${code ? ` [${code}]` : ""}`);
}

export async function countExpiredBeta(): Promise<number> {
  const admin = getSupabaseAdmin();
  const { count, error } = await admin
    .from("tenants")
    .select("id", { count: "exact", head: true })
    .eq("billing_enforcement", "off")
    .not("beta_expires_at", "is", null)
    .lt("beta_expires_at", new Date().toISOString());
  if (error) {
    if (/beta_expires_at|billing_enforcement/i.test(error.message)) return 0;
    throw error;
  }
  return count || 0;
}

async function loadPhoneLine(): Promise<PhoneLineTelecomInput> {
  if (!isSautikitConfigured()) return { status: "not_configured" };
  try {
    const numbers = await listSautikitNumbers();
    let wallet = null;
    let walletHidden = false;
    try {
      wallet = await getSautikitWallet();
      if (!wallet) walletHidden = true;
    } catch {
      walletHidden = true;
    }
    return { status: "ok", numbers, wallet, walletHidden };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function loadOpsSettings(): Promise<{ settings: OpsSettings; persisted: boolean }> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("platform_ops_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    if (!data) {
      const people = parsePeople([], envEmails());
      return {
        settings: { ...defaultOpsSettings(), emails: emailsFromPeople(people), people },
        persisted: true,
      };
    }
    const emails = Array.isArray(data.emails) ? parseOpsEmails(data.emails.join(",")) : envEmails();
    const people = parsePeople(data.people, emails.length ? emails : envEmails());
    return {
      settings: {
        emails: emailsFromPeople(people).length ? emailsFromPeople(people) : emails,
        people,
        kinds: parseKindFlags(data.kinds),
        sautikitWarnMinor: Number(data.sautikit_warn_minor) || defaultOpsSettings().sautikitWarnMinor,
      },
      persisted: true,
    };
  } catch (err) {
    if (isMissingTable(err)) {
      warnMissingOpsTable("platform_ops_settings", err);
      const people = parsePeople([], envEmails());
      return {
        settings: { ...defaultOpsSettings(), emails: emailsFromPeople(people).length ? emailsFromPeople(people) : envEmails(), people },
        persisted: false,
      };
    }
    throw err;
  }
}

export async function saveOpsSettings(input: {
  emails?: string[];
  people?: ReturnType<typeof parsePeople>;
  kinds: OpsKindFlags;
  sautikitWarnMinor: number;
}): Promise<OpsSettings> {
  const people = parsePeople(input.people || [], input.emails || []);
  const emails = emailsFromPeople(people);
  const settings: OpsSettings = {
    emails,
    people,
    kinds: input.kinds,
    sautikitWarnMinor: Math.max(0, Math.round(input.sautikitWarnMinor)),
  };
  const admin = getSupabaseAdmin();
  const row = {
    id: 1,
    emails: settings.emails,
    people: settings.people,
    kinds: settings.kinds,
    sautikit_warn_minor: settings.sautikitWarnMinor,
    updated_at: new Date().toISOString(),
  };
  let { error } = await admin.from("platform_ops_settings").upsert(row);
  if (error && /people/i.test(error.message)) {
    const fallback = { ...row };
    delete (fallback as { people?: unknown }).people;
    ({ error } = await admin.from("platform_ops_settings").upsert(fallback));
  }
  if (error) throw error;
  return settings;
}

/** Open notices, or null when the notices table is missing. */
async function readOpenOpsNotices(): Promise<OpsNotice[] | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("platform_ops_notices")
      .select("id, kind, status, detail, notified_at")
      .in("status", ["open", "acked"])
      .order("opened_at", { ascending: false });
    if (error) throw error;
    return (data || []) as OpsNotice[];
  } catch (err) {
    if (isMissingTable(err)) {
      warnMissingOpsTable("platform_ops_notices", err);
      return null;
    }
    throw err;
  }
}

export async function listOpenOpsNotices(): Promise<OpsNotice[]> {
  return (await readOpenOpsNotices()) ?? [];
}

async function persistOpen(kind: OpsNoticeKind, detail: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await admin.from("platform_ops_notices").insert({
    kind,
    status: "open",
    detail,
    opened_at: now,
    notified_at: now,
  });
  if (error) throw error;
}

async function persistNotify(kind: OpsNoticeKind, detail: string): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("platform_ops_notices")
    .update({ detail, notified_at: now })
    .eq("kind", kind)
    .in("status", ["open", "acked"]);
  if (error) throw error;
}

async function persistResolve(kind: OpsNoticeKind): Promise<void> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await admin
    .from("platform_ops_notices")
    .update({ status: "resolved", resolved_at: now })
    .eq("kind", kind)
    .in("status", ["open", "acked"]);
  if (error) throw error;
}

export async function ackOpsNotice(kind: OpsNoticeKind): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("platform_ops_notices")
    .update({ status: "acked", acked_at: new Date().toISOString() })
    .eq("kind", kind)
    .eq("status", "open");
  if (error) throw error;
}

async function mailKinds(
  kinds: OpsNoticeKind[],
  emails: string[],
  signals: OpsSignal[],
  recovered = false,
): Promise<void> {
  if (!isOpsMailConfigured() || !emails.length) return;
  const byKind = new Map(signals.map((signal) => [signal.kind, signal]));
  for (const kind of kinds) {
    const signal = byKind.get(kind);
    const detail = recovered ? `${kindLabel(kind)} recovered` : signal?.detail || kindLabel(kind);
    const state = recovered ? "recovered" : "open";
    await sendOpsMail({
      to: emails,
      subject: opsMailSubject(kind, recovered),
      text: `${detail}\n\nOpen Platform: /admin/platform`,
      // Platform notify_sends row; one per notice state per hour.
      ledger: {
        kind: `platform_ops_${kind}`,
        key: `ops:desk:${kind}:${state}:${new Date().toISOString().slice(0, 13)}`,
      },
    });
  }
}

export async function evaluatePlatformOps(): Promise<{
  settings: OpsSettings;
  persisted: boolean;
  signals: OpsSignal[];
  strip: ReturnType<typeof deriveStatusStrip>;
  notices: OpsNotice[];
  infra: ReturnType<typeof infraFromEnv>;
  mailConfigured: boolean;
}> {
  await requireSuperAdmin();
  const [{ settings, persisted }, pool, pending, expiredBeta, voice, telecom] = await Promise.all([
    loadOpsSettings(),
    listDidPool().catch(() => []),
    listPendingTenants().catch(() => []),
    countExpiredBeta().catch(() => 0),
    fetchVoiceHealthz(),
    loadPhoneLine(),
  ]);

  const availableDids = pool.filter((row) => row.status === "available").length;
  const walletMinor =
    telecom.status === "ok" && telecom.wallet ? telecom.wallet.balance_minor : null;
  const signals = deriveOpsSignals({
    speech: deriveSpeechHealth(voice),
    reasoning: deriveReasoningHealth(voice),
    phoneLine: derivePhoneLineHealth(telecom),
    walletMinor,
    sautikitWarnMinor: settings.sautikitWarnMinor,
    availableDids,
    waitingBusinesses: pending.length,
    expiredBetaCount: expiredBeta,
  });
  const strip = deriveStatusStrip(signals);
  const existing = persisted ? await readOpenOpsNotices() : null;
  // Without the notices table there is nothing to open, dedupe, or mail against.
  const noticesReady = existing !== null;
  const plan = reconcileNotices(existing ?? [], signals, settings.kinds);

  if (noticesReady) {
    const byKind = new Map(signals.map((signal) => [signal.kind, signal]));
    for (const kind of plan.open) {
      await persistOpen(kind, byKind.get(kind)?.detail || kindLabel(kind));
    }
    for (const kind of plan.notify.filter((k) => !plan.open.includes(k))) {
      await persistNotify(kind, byKind.get(kind)?.detail || kindLabel(kind));
    }
    for (const kind of plan.resolve) {
      await persistResolve(kind);
    }
    try {
      await mailKinds(plan.notify, settings.emails, signals, false);
      await mailKinds(plan.resolve, settings.emails, signals, true);
    } catch (err) {
      console.error("[admin:ops-mail]", err instanceof Error ? err.message : err);
    }
  }

  return {
    settings,
    persisted,
    signals,
    strip,
    notices: noticesReady ? await listOpenOpsNotices() : [],
    infra: infraFromEnv({
      voiceReachable: voice.status === "ok" ? true : voice.status === "unreachable" ? false : null,
      supabaseUrl: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      vercelEnv: process.env.VERCEL_ENV || "",
    }),
    mailConfigured: isOpsMailConfigured(),
  };
}
