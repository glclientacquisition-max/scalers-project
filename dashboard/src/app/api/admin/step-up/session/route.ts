import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAdminOperatorWrite } from "@/lib/adminOperatorWrite";
import { SIGNIN_COOKIE, UNLOCK_COOKIE } from "@/lib/ops/stepUpCore";
import { auditStepUp, revokeGrant } from "@/lib/ops/stepUpStore";

const gone = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 0 };

/**
 * Settings › Security: end your own Unlock now, or forget this device (12 h sign-in trust).
 * Both only narrow access, so neither needs Unlock. Device trust is a signed cookie, not a
 * stored session, so "forget" covers this device only.
 */
export async function POST(req: Request) {
  const gate = await requireAdminOperatorWrite();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const body = (await req.json().catch(() => ({}))) as { op?: unknown };
  const op = String(body.op || "");
  const jar = await cookies();

  if (op === "end_unlock") {
    await revokeGrant(jar.get(UNLOCK_COOKIE)?.value);
    await auditStepUp(gate.operator, "admin.step_up.ended", {});
    const res = NextResponse.json({ ok: true });
    res.cookies.set(UNLOCK_COOKIE, "", gone);
    return res;
  }
  if (op === "forget_device") {
    await auditStepUp(gate.operator, "admin.2fa.device_forgotten", {});
    const res = NextResponse.json({ ok: true, next: "/admin/login?step=2fa" });
    res.cookies.set(SIGNIN_COOKIE, "", gone);
    return res;
  }
  return NextResponse.json({ error: "Unknown op." }, { status: 400 });
}
