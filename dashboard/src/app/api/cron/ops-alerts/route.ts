import { NextResponse } from "next/server";
import { runScheduledOpsAlerts } from "@/lib/opsAlerts";
import { cronAuthorized } from "@/lib/opsAlertsRun";

/**
 * Authenticated ops-alert pass. Hobby Vercel cannot run a sub-daily cron, so
 * nothing in vercel.json schedules this. Railway Voice calls it.
 * Contract: docs/reference/operations/OPS_ALERTS_ENDPOINT.md
 * Refuses anything without `Authorization: Bearer $CRON_SECRET`.
 * With no CRON_SECRET set, or a secret under 16 characters, it refuses everything.
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
      opened: result.opened.length,
      resolved: result.resolved.length,
      sent: result.sent.length,
      wouldSend: result.wouldSend.length,
      quieted: result.quieted.length,
      failed: result.failed.length,
    });
  } catch (err) {
    console.error("[ops-alerts]", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Check failed." }, { status: 500 });
  }
}
