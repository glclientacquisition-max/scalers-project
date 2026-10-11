import { NextResponse } from "next/server";
import { runScheduledOpsAlerts } from "@/lib/opsAlerts";
import { cronAuthorized } from "@/lib/opsAlertsRun";

/**
 * Vercel cron, every 10 minutes (dashboard/vercel.json). Opens and resolves platform notices and
 * mails the Admin recipients list once per notice. Refuses anything without
 * `Authorization: Bearer $CRON_SECRET`; with no CRON_SECRET set it refuses everything.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  try {
    const result = await runScheduledOpsAlerts();
    return NextResponse.json({
      ok: true,
      dryRun: result.dryRun,
      recipients: result.recipients,
      opened: result.opened,
      resolved: result.resolved,
      sent: result.sent.length,
      wouldSend: result.wouldSend.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error("[ops-alerts]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Check failed." }, { status: 500 });
  }
}
