import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import { validateResetReason } from "@/lib/ops/stepUpCore";
import { clampUnlockMinutes } from "@/lib/ops/stepUpTime";
import { stepUpGate } from "@/lib/ops/stepUpGate";
import { auditStepUp, loadUnlockMinutes, saveUnlockMinutes } from "@/lib/ops/stepUpStore";

/**
 * Settings › Security "Unlock lasts": 5, 10, 15 or 30 minutes (server clamps to 5–30).
 * Always needs a live Unlock and a reason; writes ops_audit_log admin.step_up.duration_changed.
 * Applies to the next Unlock; a live Unlock keeps the expiry it was given.
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (stepUpMode() !== "enforce") return NextResponse.json({ error: "step_up_not_enforced" }, { status: 409 });
  const body = (await req.json().catch(() => ({}))) as { minutes?: unknown; reason?: unknown };
  if (body.minutes == null || !Number.isFinite(Number(body.minutes))) return NextResponse.json({ error: "Pick how long Unlock lasts." }, { status: 400 });
  const reason = validateResetReason(body.reason);
  if (!reason) return NextResponse.json({ error: "Add a reason (3 characters or more)." }, { status: 400 });
  const stepUp = await stepUpGate(gate.operator, "step-up:set_duration", String(body.minutes));
  if (stepUp) return stepUp;
  const minutes = clampUnlockMinutes(body.minutes);
  const from = await loadUnlockMinutes();
  await saveUnlockMinutes(minutes, gate.operator);
  await auditStepUp(gate.operator, "admin.step_up.duration_changed", { from, to: minutes, asked: Number(body.minutes) }, reason);
  return NextResponse.json({ ok: true, minutes, appliesTo: "next_unlock" });
}
