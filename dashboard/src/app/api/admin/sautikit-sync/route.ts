import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { recordAdminAction } from "@/lib/adminAudit";
import { logAdminError, operatorError } from "@/lib/adminErrors";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { syncPoolFromSautikit } from "@/lib/didPool";
import { getSautikitKeyDiagnostics, isSautikitConfigured } from "@/lib/sautikit";

export async function POST() {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
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
