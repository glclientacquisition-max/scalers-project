import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/admin-auth";
import { SESSION_COOKIE, sessionCookieValue } from "@/lib/auth";

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

  const res = NextResponse.redirect(new URL("/admin", request.url), 303);
  copyAuthCookies(authRes, res);
  if (process.env.DASHBOARD_PASSWORD) {
    res.cookies.set(SESSION_COOKIE, sessionCookieValue(), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14,
    });
  }
  return res;
}
