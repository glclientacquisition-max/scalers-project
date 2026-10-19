import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { logAdminError } from "@/lib/adminErrors";
import { requireSuperAdmin } from "@/lib/adminGuard";
import { issueKsh10TestInvoice, supabaseTestInvoiceDb, testInvoiceFailure, testInvoicePostError } from "@/lib/invoicePay/testInvoice";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Super Admin only. Issues one KSh 10 invoice and the existing pay link.
 * Does not change the plan price. The pay path is returned once.
 * Signed-out visitors are redirected to /admin/login by requireSuperAdmin.
 */
export async function POST(request: Request) {
  await requireSuperAdmin();
  const body = await request.json().catch(() => null);
  const problem = testInvoicePostError(body);
  if (problem || !body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: problem || "Confirm the test invoice." }, { status: 400 });
  }
  const posted = body as { tenantId: string; reason: string };
  const actor = await adminActorName();
  try {
    const issued = await issueKsh10TestInvoice(supabaseTestInvoiceDb(getSupabaseAdmin()), {
      tenantId: posted.tenantId,
      reason: posted.reason,
      actor,
    });
    return NextResponse.json({ ok: true, ...issued });
  } catch (error) {
    logAdminError("ksh10-test-invoice", error);
    const failure = testInvoiceFailure(error);
    return NextResponse.json({ ok: false, error: failure.error }, { status: failure.status });
  }
}
