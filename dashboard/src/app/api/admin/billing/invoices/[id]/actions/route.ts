import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import {
  issueAdminCreditNote,
  resendAdminInvoice,
  setAdminInvoiceDispute,
  voidAdminInvoice,
} from "@/lib/adminInvoiceActions";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { logAdminError } from "@/lib/adminErrors";
import { requireStepUp, stepUpMode } from "@/lib/ops/stepUp";

type Body = {
  action?: unknown;
  reason?: unknown;
  email?: unknown;
  mode?: unknown;
};

/**
 * Invoice money actions (s29): void, full credit note, resend, dispute.
 * Void / credit / dispute need docs/supabase/admin_invoice_actions.sql —
 * missing RPC → 501 honest, never fake success. Resend is real via ops mail.
 */
export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Pick an invoice." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const action = String(body.action || "").trim();
  const reason = String(body.reason || "").trim();
  const actor = await adminActorName();

  const mode = stepUpMode();
  if (mode === "observe") {
    requireStepUp({ action: `invoice:${action || "unknown"}`, operator: gate.operator, target: id });
  } else if (mode === "enforce") {
    return NextResponse.json(
      { error: "Authenticator not set up yet", mode, verified: false },
      { status: 501 },
    );
  }

  try {
    if (action === "void") {
      const result = await voidAdminInvoice({ invoiceId: id, actor, reason });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "credit_note") {
      const result = await issueAdminCreditNote({ invoiceId: id, actor, reason });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "dispute" || action === "clear_dispute") {
      const result = await setAdminInvoiceDispute({
        invoiceId: id,
        paused: action === "dispute",
        actor,
        reason,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    if (action === "resend") {
      const rawMode = String(body.mode || "saved").trim();
      const resendMode =
        rawMode === "typed" || rawMode === "both" || rawMode === "saved" ? rawMode : null;
      if (!resendMode) {
        return NextResponse.json({ error: "Pick saved contact, typed email, or both." }, { status: 400 });
      }
      const result = await resendAdminInvoice({
        invoiceId: id,
        actor,
        mode: resendMode,
        typedEmail: String(body.email || ""),
        reason: reason || undefined,
      });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "That action isn't available." }, { status: 400 });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 0;
    const message = err instanceof Error ? err.message : "That didn't save. Nothing changed.";
    if (!status || status >= 500) logAdminError("invoice-actions", err);
    return NextResponse.json({ error: message }, { status: status && status >= 400 ? status : 500 });
  }
}
