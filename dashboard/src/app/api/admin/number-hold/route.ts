import { NextResponse } from "next/server";
import { recordAdminAction } from "@/lib/adminAudit";
import { adminActorName } from "@/lib/adminActor";
import {
  endNumberHold,
  holdNumberForWinback,
  restoreHeldNumber,
  setNumberHoldSettings,
} from "@/lib/adminNumberHold";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { clampHoldDays, reactivationFeeBillStub } from "@/lib/ops/numberHold";
import { protectedNumberRefusal } from "@/lib/ops/numberOps";
import { stepUpGate } from "@/lib/ops/stepUpGate";

/**
 * Number hold / win-back writers (Admin s28). Calls #885 RPCs when present;
 * returns 503 with a plain message when the SQL is not on this database.
 * Never invents a reactivation charge — bill_fee is an honest stub.
 */
export async function POST(request: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Confirm the change." }, { status: 400 });
  }

  const action = String(body.action || "");
  // Protected platform line: no hold, end hold or restore, before Unlock or any database call.
  const refused = protectedNumberRefusal(body.e164);
  if (refused) return NextResponse.json(refused.body, { status: refused.status });
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 3 && action !== "bill_fee") {
    return NextResponse.json({ error: "Add a reason (3 characters or more)." }, { status: 400 });
  }

  const target =
    action === "set_settings"
      ? "settings:hold"
      : String(body.e164 || body.tenant_id || "");
  const stepUp = await stepUpGate(gate.operator, `number-hold:${action}`, target);
  if (stepUp) return stepUp;

  if (action === "bill_fee") {
    // Honest stub — Invoicing owns the package-invoice line. Never ok:true.
    const stub = reactivationFeeBillStub();
    return NextResponse.json(stub, { status: 501 });
  }

  if (action === "set_settings") {
    const clearFee = body.clear_fee === true;
    const feeRaw = body.fee_kes;
    const feeKes =
      feeRaw == null || feeRaw === ""
        ? null
        : Number(feeRaw);
    if (!clearFee && feeKes != null && (!Number.isFinite(feeKes) || feeKes <= 0)) {
      return NextResponse.json({ error: "Reactivation fee must be above zero, or cleared for none." }, { status: 400 });
    }
    const daysRaw = body.days;
    const days =
      daysRaw == null || daysRaw === ""
        ? null
        : clampHoldDays(Number(daysRaw));
    const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
    const result = await setNumberHoldSettings({
      enabled,
      feeKes: clearFee ? null : feeKes,
      clearFee,
      days,
      reason,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status });
    await recordAdminAction({
      actor: await adminActorName(),
      action: "set_number_hold_settings",
      reason,
      after: result.data,
    });
    return NextResponse.json({ ok: true, settings: result.data });
  }

  if (action === "hold") {
    const e164 = String(body.e164 || "").trim();
    if (!e164) return NextResponse.json({ error: "Number required." }, { status: 400 });
    const days = body.days == null || body.days === "" ? null : clampHoldDays(Number(body.days));
    const result = await holdNumberForWinback({ e164, days, reason });
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status });
    await recordAdminAction({
      actor: await adminActorName(),
      action: "hold_number_for_winback",
      reason,
      after: result.data,
    });
    return NextResponse.json({ ok: true, ...(result.data as object) });
  }

  if (action === "end_hold") {
    const e164 = String(body.e164 || "").trim();
    if (!e164) return NextResponse.json({ error: "Number required." }, { status: 400 });
    const result = await endNumberHold({ e164, reason });
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status });
    await recordAdminAction({
      actor: await adminActorName(),
      action: "end_number_hold",
      reason,
      after: result.data,
    });
    return NextResponse.json({ ok: true, ...(result.data as object) });
  }

  if (action === "restore") {
    const e164 = String(body.e164 || "").trim();
    const tenantId = String(body.tenant_id || "").trim();
    if (!e164 || !tenantId) {
      return NextResponse.json({ error: "Number and previous business required." }, { status: 400 });
    }
    const result = await restoreHeldNumber({ e164, tenantId, reason });
    if (!result.ok) return NextResponse.json({ error: result.error, missing: result.missing }, { status: result.status });
    await recordAdminAction({
      actor: await adminActorName(),
      action: "restore_held_number",
      businessId: tenantId,
      reason,
      after: result.data,
    });
    return NextResponse.json({ ok: true, ...(result.data as object) });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
