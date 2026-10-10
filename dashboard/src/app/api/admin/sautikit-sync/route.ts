import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { recordAdminAction } from "@/lib/adminAudit";
import { logAdminError, operatorError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import { syncPoolFromSautikit } from "@/lib/didPool";
import { getSautikitKeyDiagnostics, isSautikitConfigured } from "@/lib/sautikit";

export async function POST() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!isSautikitConfigured()) {
    // Key diagnostics stay in the server log; the operator gets plain copy.
    logAdminError("number-sync", { message: "phone line key missing", diagnostics: getSautikitKeyDiagnostics() });
    return NextResponse.json({ error: "Sync is not set up on this server yet." }, { status: 500 });
  }

  try {
    const result = await syncPoolFromSautikit();
    await recordAdminAction({
      actor: await adminActorName(),
      action: "sync_numbers",
      after: { added: result.added, linked: result.linked },
      detail: { skipped: result.skipped.length },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logAdminError("number-sync-diagnostics", { message: "sync failed", diagnostics: getSautikitKeyDiagnostics() });
    return NextResponse.json({ error: operatorError("number-sync", err, "Could not sync numbers.") }, { status: 500 });
  }
}
