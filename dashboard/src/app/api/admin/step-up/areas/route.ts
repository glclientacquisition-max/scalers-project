import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import { isUnlockArea, validateResetReason } from "@/lib/ops/stepUpCore";
import { stepUpGate } from "@/lib/ops/stepUpGate";
import { auditStepUp, saveAreaSetting } from "@/lib/ops/stepUpStore";

/**
 * Settings › Security "What needs Unlock": switch one area on or off.
 * Always needs a live Unlock and a reason; writes ops_audit_log. Always-on actions ignore the switch.
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (stepUpMode() !== "enforce") return NextResponse.json({ error: "step_up_not_enforced" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { area?: unknown; required?: unknown; reason?: unknown };
  if (!isUnlockArea(body.area)) return NextResponse.json({ error: "Pick an area." }, { status: 400 });
  if (typeof body.required !== "boolean") return NextResponse.json({ error: "Say on or off." }, { status: 400 });
  const reason = validateResetReason(body.reason);
  if (!reason) return NextResponse.json({ error: "Add a reason (3 characters or more)." }, { status: 400 });
  const stepUp = await stepUpGate(gate.operator, "step-up:set_area", body.area);
  if (stepUp) return stepUp;
  await saveAreaSetting(body.area, body.required, gate.operator);
  await auditStepUp(gate.operator, "admin.step_up.area_changed", { area: body.area, required: body.required }, reason);
  return NextResponse.json({ ok: true, area: body.area, required: body.required });
}
