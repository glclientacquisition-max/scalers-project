import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieValue } from "@/lib/auth";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") || "");
  const expected = process.env.DASHBOARD_PASSWORD || "";

  if (!expected || password !== expected) {
    return NextResponse.redirect(new URL("/login?error=1", request.url), 303);
  }

  const res = NextResponse.redirect(new URL("/calls", request.url), 303);
  res.cookies.set(SESSION_COOKIE, sessionCookieValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });
  return res;
}
