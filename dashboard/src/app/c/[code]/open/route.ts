import { NextRequest, NextResponse } from "next/server";
import { DESK_TENANT_COOKIE, deskTenantCookieOptions } from "@/lib/inviteAccept";
import { resolveShortCallLink } from "@/lib/shortCallLinkServer";

/** Same checks as /c/<code>, then picks the call's business before opening it. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const next = await resolveShortCallLink(code);
  if (next.kind === "login") return NextResponse.redirect(new URL(next.href, request.url), 303);
  if (next.kind === "not_found") return NextResponse.redirect(new URL(`/c/${encodeURIComponent(code)}`, request.url), 303);
  const res = NextResponse.redirect(new URL(next.href, request.url), 303);
  res.cookies.set(DESK_TENANT_COOKIE, next.tenantId, deskTenantCookieOptions);
  return res;
}
