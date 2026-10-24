import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { stepUpMode } from "@/lib/ops/stepUp";
import { generateBackupCodes, hashBackupCode } from "@/lib/ops/stepUpCore";
import { stepUpGate } from "@/lib/ops/stepUpGate";
import { auditStepUp, loadFactor, replaceBackupCodes, stepUpKey } from "@/lib/ops/stepUpStore";

/** Regenerate your own 10 backup codes (live unlock required). Old codes stop working. Codes are returned once, never emailed or logged. */
export async function POST() {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (stepUpMode() !== "enforce") return NextResponse.json({ error: "step_up_not_enforced" }, { status: 409 });
  const stepUp = await stepUpGate(gate.operator, "step-up:regenerate_backup_codes", gate.operator);
  if (stepUp) return stepUp;
  const factor = await loadFactor(gate.operator);
  if (!factor?.enrolled_at || !factor.secret_enc) return NextResponse.json({ error: "Set up your authenticator first." }, { status: 409 });
  const key = stepUpKey();
  const codes = generateBackupCodes();
  await replaceBackupCodes(gate.operator, codes.map((c) => hashBackupCode(c, key)));
  await auditStepUp(gate.operator, "admin.2fa.backup_codes_regenerated", { count: codes.length });
  return NextResponse.json({ ok: true, backupCodes: codes });
}
