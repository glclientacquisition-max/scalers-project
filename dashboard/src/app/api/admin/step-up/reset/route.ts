import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { findAdminOperator, normalizeAdminUsername } from "@/lib/adminOperators";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import { grantValid, UNLOCK_COOKIE, validateResetReason } from "@/lib/ops/stepUpCore";
import { loadGrant, resetFactor, sendStepUpNotice } from "@/lib/ops/stepUpStore";

/**
 * Operator reset: another Super Admin, with their own live unlock and a reason, clears
 * someone's authenticator. The DB function writes the audit row; the target re-enrols next sign-in.
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (stepUpMode() !== "enforce") return NextResponse.json({ error: "step_up_not_enforced" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { target?: unknown; reason?: unknown };
  const reason = validateResetReason(body.reason);
  if (!reason) return NextResponse.json({ error: "Add a reason (3 characters or more)." }, { status: 400 });
  const target = normalizeAdminUsername(String(body.target || ""));
  if (!target || !findAdminOperator(target)) return NextResponse.json({ error: "Pick an operator." }, { status: 400 });
  if (target === gate.operator) return NextResponse.json({ error: "Use a backup code to reset your own authenticator." }, { status: 400 });
  const jar = await cookies();
  const grant = await loadGrant(jar.get(UNLOCK_COOKIE)?.value);
  if (!grantValid(grant, gate.operator, Date.now())) {
    return NextResponse.json({ error: "step_up_required", message: "Unlock with your own code first." }, { status: 403 });
  }
  await resetFactor(target, gate.operator, reason);
  await sendStepUpNotice("authenticator_reset", target, `Reset by ${gate.operator}. Reason: ${reason}`);
  return NextResponse.json({ ok: true });
}
