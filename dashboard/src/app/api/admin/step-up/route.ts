import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { requireStepUp, stepUpMode } from "@/lib/ops/stepUp";

/**
 * StepUpSheet backend (s23). Unlock never writes domain state.
 * observe: logs would-require-step-up and returns { mode, verified:false }.
 * enforce: no code verifier yet (#876 Q9 open) — returns 501, never fakes success.
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; target?: unknown };
  const action = String(body.action || "unlock").slice(0, 64);
  const target = body.target == null ? null : String(body.target).slice(0, 64);
  const mode = stepUpMode();
  if (mode === "enforce") {
    return NextResponse.json({ mode, verified: false, error: "step_up_not_enrolled", message: "Authenticator not set up yet" }, { status: 501 });
  }
  if (mode === "observe") requireStepUp({ action: `unlock:${action}`, operator: gate.operator, target });
  return NextResponse.json({ mode, verified: false });
}
