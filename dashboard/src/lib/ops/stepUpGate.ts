import "server-only";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { gateDecision, isRiskyAction, stepUpEnforced, UNLOCK_COOKIE } from "./stepUpCore";
import { requireStepUp } from "./stepUp";
import { auditStepUp, loadGrant } from "./stepUpStore";

/**
 * Server gate for risky Admin writes. Call right after requireAdminOperatorWrite.
 * Returns a 403 response when ADMIN_STEP_UP_ENFORCE=on and the operator has no live unlock;
 * otherwise null (observe mode logs as before). The client button is never the only gate.
 */
export async function stepUpGate(operator: string, actionKey: string, target?: string | null): Promise<NextResponse | null> {
  requireStepUp({ action: actionKey, operator, target: target ?? null });
  if (!stepUpEnforced()) return null;
  const jar = await cookies();
  const grant = await loadGrant(jar.get(UNLOCK_COOKIE)?.value);
  const d = gateDecision({ enforced: true, actionKey, operator, grant, nowMs: Date.now() });
  if (d.ok) return null;
  await auditStepUp(operator, "admin.step_up.blocked", { intent: actionKey, target: target ?? null });
  return NextResponse.json(
    { error: d.error, message: "Unlock with your authenticator code first.", action: actionKey },
    { status: d.status },
  );
}

/**
 * For routes still on the legacy session gate: risky actions resolve the operator
 * from the Super Admin session, then apply stepUpGate. Non-risky actions pass untouched.
 */
export async function stepUpGateSession(actionKey: string, target?: string | null): Promise<NextResponse | null> {
  if (!isRiskyAction(actionKey)) return null;
  const op = await requireAdminOperatorWrite();
  if (!op.ok) {
    if (!stepUpEnforced()) return null;
    return NextResponse.json({ error: op.error }, { status: op.status });
  }
  return stepUpGate(op.operator, actionKey, target);
}
