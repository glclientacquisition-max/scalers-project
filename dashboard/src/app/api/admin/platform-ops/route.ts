import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  ensureOpsResendDomain,
  getOpsResendDomain,
  sendOpsMail,
  verifyOpsResendDomain,
} from "@/lib/opsMail";
import { ackOpsNotice, loadOpsSettings, saveOpsSettings } from "@/lib/platformOps";
import { countRecordingPurgeAtNextRun } from "@/lib/recordingRetentionAdmin";
import {
  DEFAULT_SAUTIKIT_WARN_MINOR,
  OPS_NOTICE_KINDS,
  parseKindFlags,
  parseOpsEmails,
  parsePeople,
  parseRecordingRetentionDays,
  type OpsNoticeKind,
} from "@/lib/platformOpsModel";

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  try {
    return NextResponse.json({ ok: true, domain: await getOpsResendDomain() });
  } catch (err) {
    logAdminError("platform-ops", err);
    return NextResponse.json({ error: adminFacingError(err, "Could not check email sending.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const actor = await adminActorName();

  try {
    if (action === "recording_retention_preview") {
      const proposed = parseRecordingRetentionDays(body.recording_retention_days);
      const { count, capped } = await countRecordingPurgeAtNextRun(proposed);
      return NextResponse.json({ ok: true, count, capped });
    }

    if (action === "save_settings") {
      const before = (await loadOpsSettings().catch(() => null))?.settings ?? null;
      const settings = await saveOpsSettings({
        people: parsePeople(body.people, parseOpsEmails(
          Array.isArray(body.emails) ? body.emails.join(",") : String(body.emails || ""),
        )),
        kinds: parseKindFlags(body.kinds),
        sautikitWarnMinor: Number.isFinite(Number(body.sautikit_warn_minor))
          ? Number(body.sautikit_warn_minor)
          : DEFAULT_SAUTIKIT_WARN_MINOR,
        recordingRetentionDays:
          body.recording_retention_days !== undefined
            ? parseRecordingRetentionDays(body.recording_retention_days)
            : before?.recordingRetentionDays ?? null,
      });
      const retentionBefore = before?.recordingRetentionDays ?? null;
      const retentionAfter = settings.recordingRetentionDays ?? null;
      const alertBefore = before
        ? {
            emails: before.emails,
            people: before.people,
            kinds: before.kinds,
            sautikitWarnMinor: before.sautikitWarnMinor,
          }
        : null;
      const alertAfter = {
        emails: settings.emails,
        people: settings.people,
        kinds: settings.kinds,
        sautikitWarnMinor: settings.sautikitWarnMinor,
      };
      await recordAdminAction({ actor, action: "save_alert_settings", before: alertBefore, after: alertAfter });
      if (retentionBefore !== retentionAfter) {
        await recordAdminAction({
          actor,
          action: "save_recording_retention_platform",
          before: { recording_retention_days: retentionBefore },
          after: { recording_retention_days: retentionAfter },
        });
      }
      return NextResponse.json({ ok: true, settings });
    }

    if (action === "test_send") {
      const emails = parseOpsEmails(
        Array.isArray(body.emails) ? body.emails.join(",") : String(body.emails || ""),
      );
      const result = await sendOpsMail({
        to: emails,
        subject: "Scalers ops: test",
        text: "Test from Platform.",
        ledger: {
          kind: "platform_ops_test",
          key: `ops:desk:test:${new Date().toISOString().slice(0, 16)}`,
        },
      });
      if (result.skipped === "ops_mail_unconfigured") {
        return NextResponse.json({ error: "Mail is off." }, { status: 400 });
      }
      if (result.skipped === "no_recipients") {
        return NextResponse.json({ error: "Add a person first." }, { status: 400 });
      }
      await recordAdminAction({ actor, action: "test_alert_mail", after: { sent_to: emails.length } });
      return NextResponse.json({ ok: true });
    }

    if (action === "prepare_resend") {
      const domain = await ensureOpsResendDomain();
      await recordAdminAction({ actor, action: "prepare_mail_domain", after: { status: domain.status } });
      return NextResponse.json({ ok: true, domain });
    }

    if (action === "verify_resend") {
      const domain = await verifyOpsResendDomain();
      await recordAdminAction({ actor, action: "verify_mail_domain", after: { status: domain.status } });
      return NextResponse.json({ ok: true, domain });
    }

    if (action === "ack") {
      const kind = String(body.kind || "") as OpsNoticeKind;
      if (!OPS_NOTICE_KINDS.includes(kind)) {
        return NextResponse.json({ error: "Unknown notice." }, { status: 400 });
      }
      await ackOpsNotice(kind);
      await recordAdminAction({ actor, action: "ack_notice", before: { kind, status: "open" }, after: { kind, status: "acked" } });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    logAdminError("platform-ops", err);
    return NextResponse.json({ error: adminFacingError(err, "Could not save.") }, { status: 500 });
  }
}
