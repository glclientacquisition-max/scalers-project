import { NextResponse } from "next/server";
import { auditNumberOp, currentStepUpProof, runNumberOp } from "@/lib/adminNumberOps";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { validateNumberOp } from "@/lib/ops/numberOps";
import { stepUpGate } from "@/lib/ops/stepUpGate";

/**
 * Admin number controls v1: Restore, Lift quarantine, Move (#968 RPCs, service role).
 * Order: operator session, input check, Unlock gate,
 * then the RPC. The RPC audits the change itself; we add a row carrying the Unlock proof.
 */
export async function POST(request: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const checked = validateNumberOp(body);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.error, code: checked.code }, { status: checked.status });
  }
  const input = checked.input;

  const stepUp = await stepUpGate(gate.operator, `number-ops:${input.action}`, input.e164 ?? (input.action === "restore" ? input.businessId : null));
  if (stepUp) return stepUp;

  let out: Awaited<ReturnType<typeof runNumberOp>>;
  switch (input.action) {
    case "restore":
    case "lift_quarantine":
    case "move":
      out = await runNumberOp(input, gate.operator);
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const proof = await currentStepUpProof();
  if (!out.ok) {
    return NextResponse.json(
      { error: out.error, code: out.code, suggestRestore: out.suggestRestore ?? false, needsConfirm: out.needsConfirm ?? false },
      { status: out.status },
    );
  }
  await auditNumberOp({
    actor: gate.operator,
    input,
    outcome: out.result.noop ? "already_done" : "done",
    stepUp: proof,
    result: out.result,
  });
  return NextResponse.json(out.result);
}
