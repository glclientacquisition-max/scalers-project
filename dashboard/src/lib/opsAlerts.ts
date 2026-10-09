import { isMissingTableError } from "@/lib/adminErrors";
import { isOpsMailConfigured, sendOpsMail } from "@/lib/opsMail";
import { gatherPlatformSignals } from "@/lib/platformOps";
import { kindLabel, opsMailSubject, type OpsNoticeKind } from "@/lib/platformOpsModel";
import {
  alertRecipients,
  opsAlertsDryRun,
  runOpsAlerts,
  type AlertNotice,
  type AlertRunResult,
  type AlertStore,
} from "@/lib/opsAlertsRun";
import { getSupabaseAdmin } from "@/lib/supabase";

const TABLE = "platform_ops_notices";
const LIVE = ["open", "acked"];

/** platform_ops_notices through the service role. Every write is conditional so parallel runs can't double up. */
function supabaseAlertStore(): AlertStore {
  const db = getSupabaseAdmin();
  return {
    async readOpenNotices() {
      const { data, error } = await db.from(TABLE).select("id, kind, status, notified_at").in("status", LIVE);
      if (error) throw error;
      return (data || []) as AlertNotice[];
    },
    async insertOpen(kind, detail, nowIso) {
      const { error } = await db
        .from(TABLE)
        .insert({ kind, status: "open", detail, opened_at: nowIso, notified_at: null });
      // platform_ops_notices_one_open: another run opened this kind first.
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

/** The Admin list only. Missing table or row: nobody. */
async function loadAlertSettings(): Promise<{ recipients: string[]; kinds: Record<string, boolean> }> {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("platform_ops_settings").select("emails, people, kinds").eq("id", 1).maybeSingle();
  if (error) {
    if (isMissingTableError(error)) return { recipients: [], kinds: {} };
    throw error;
  }
  const kinds: Record<string, boolean> = {};
  if (data?.kinds && typeof data.kinds === "object") {
    for (const [kind, on] of Object.entries(data.kinds as Record<string, unknown>)) {
      if (typeof on === "boolean") kinds[kind] = on;
    }
  }
  return { recipients: alertRecipients(data), kinds };
}

/**
 * One scheduled pass. Called only from the cron route, behind CRON_SECRET.
 * OPS_ALERTS_DRY_RUN unset or anything but false: notices still open and resolve, no mail.
 */
export async function runScheduledOpsAlerts(now: Date = new Date()): Promise<AlertRunResult> {
  const dryRun = opsAlertsDryRun(process.env.OPS_ALERTS_DRY_RUN) || !isOpsMailConfigured();
  // Without the notices table there is nothing to open, dedupe, or mail against.
  const probe = await getSupabaseAdmin().from(TABLE).select("id", { count: "exact", head: true });
  if (probe.error) {
    if (!isMissingTableError(probe.error)) throw probe.error;
    console.warn("[ops-alerts] platform_ops_notices missing; skipping");
    return { dryRun, recipients: 0, opened: [], resolved: [], sent: [], wouldSend: [], failed: [] };
  }
  const [{ signals }, settings] = await Promise.all([gatherPlatformSignals(), loadAlertSettings()]);
  const result = await runOpsAlerts({
    store: supabaseAlertStore(),
    signals: signals.map((s) => ({ kind: s.kind, active: s.active, detail: s.detail })),
    kinds: settings.kinds,
    recipients: settings.recipients,
    dryRun,
    now,
    compose: (kind, recovered, detail) => {
      const label = kindLabel(kind as OpsNoticeKind);
      return {
        subject: opsMailSubject(kind as OpsNoticeKind, recovered),
        text: `${recovered ? `${label} recovered` : detail || label}\n\nOpen Platform: /admin/platform`,
      };
    },
    send: async (mail) => {
      const out = await sendOpsMail(mail);
      // Nothing left the building: release the claim so a later run can send it.
      if (!out.sent) throw new Error(out.skipped || "not sent");
    },
  });
  if (result.wouldSend.length) {
    console.info("[ops-alerts] dry run, would send", JSON.stringify(result.wouldSend));
  }
  return result;
}
