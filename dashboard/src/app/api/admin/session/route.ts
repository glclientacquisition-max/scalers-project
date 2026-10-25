import { NextRequest, NextResponse } from "next/server";
import { adminAuth, isAdminAuthProperlyConfigured } from "@/lib/admin-auth";
import { normalizeAdminUsername } from "@/lib/adminOperators";
import { SIGNIN_COOKIE, signInTwoFactorRequired, verifyDeviceToken } from "@/lib/ops/stepUpCore";

function copyAuthCookies(from: Response, to: NextResponse) {
  const cookies =
    typeof from.headers.getSetCookie === "function"
      ? from.headers.getSetCookie()
      : [];
  for (const cookie of cookies) {
    to.headers.append("set-cookie", cookie);
  }
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const username = String(form.get("username") || "");
  const accessCode = String(form.get("accessCode") || "");
  const loginUrl = new URL("/admin/login?error=1", request.url);

  if (process.env.NODE_ENV === "production" && !isAdminAuthProperlyConfigured()) {
    return NextResponse.redirect(loginUrl, 303);
  }

  const jsonReq = new Request(new URL("/api/auth/sign-in/access-code", request.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: request.headers.get("cookie") || "",
      origin: request.headers.get("origin") || new URL(request.url).origin,
    },
    body: JSON.stringify({ username, accessCode }),
  });

  const authRes = await adminAuth.handler(jsonReq);
  if (!authRes.ok) {
    return NextResponse.redirect(loginUrl, 303);
  }

  // Sign-in 2FA (ADMIN_STEP_UP_ENFORCE=on): unless this device passed it in the last 12 hours,
  // the login page shows the second step. The session alone opens nothing until then.
  const remembered = verifyDeviceToken(
    request.cookies.get(SIGNIN_COOKIE)?.value, normalizeAdminUsername(username), Date.now(), String(process.env.ADMIN_STEP_UP_KEY || ""),
  );
  const dest = signInTwoFactorRequired() && !remembered ? "/admin/login?step=2fa" : "/admin";
  const res = NextResponse.redirect(new URL(dest, request.url), 303);
  copyAuthCookies(authRes, res);
  return res;
}
