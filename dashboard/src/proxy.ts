import { NextRequest, NextResponse } from "next/server";
import {
  appHostRedirect,
  configuredAdminHost,
  configuredAppHost,
  hostnameOf,
  isAdminHostAllowedPath,
  isAdminHostName,
  isLoopbackHost,
} from "@/lib/adminHost";
import { rootAuthForward } from "@/lib/authRedirect";
import { ADMIN_CACHE_CONTROL, adminGateRedirect, isNoStoreAdminPath } from "@/lib/adminGate";
import { legacySettingsRedirect } from "@/lib/businessSettingsNav";

/**
 * Super Admin gate. Runs before any page code: no admin cookie means a redirect with no body.
 * Every admin response is marked no-store so no shared cache keeps a copy.
 */
function adminGate(request: NextRequest, path: string): NextResponse | null {
  if (!isNoStoreAdminPath(path)) return null;
  const to = adminGateRedirect(
    path,
    request.cookies.getAll().map((c) => c.name),
    process.env.DASHBOARD_OPEN === "true"
  );
  const res = to ? NextResponse.redirect(new URL(to, request.url), 307) : NextResponse.next();
  res.headers.set("Cache-Control", ADMIN_CACHE_CONTROL);
  return res;
}

export function proxy(request: NextRequest) {
  const hostname = hostnameOf(request.headers.get("host"));
  const adminHost = configuredAdminHost();
  const path = request.nextUrl.pathname;

  const authForward = rootAuthForward(path, request.nextUrl.searchParams);
  if (authForward) return NextResponse.redirect(new URL(authForward, request.url), 303);

  if (adminHost && isAdminHostName(hostname)) {
    if (path === "/" || path === "/login") {
      return NextResponse.rewrite(new URL("/admin/login", request.url));
    }
    if (!isAdminHostAllowedPath(path)) {
      const dest = request.nextUrl.clone();
      dest.protocol = "https";
      dest.host = configuredAppHost();
      dest.port = "";
      return NextResponse.redirect(dest);
    }
    return adminGate(request, path) || NextResponse.next();
  }

  if (adminHost && !isLoopbackHost(hostname) && path.startsWith("/admin")) {
    const dest = request.nextUrl.clone();
    dest.protocol = "https";
    dest.host = adminHost;
    dest.port = "";
    return NextResponse.redirect(dest);
  }

  // Old Settings links (`/settings?tab=..&panel=..`) moved to `/settings/[section]`.
  if (path === "/settings") {
    const moved = legacySettingsRedirect(request.nextUrl.searchParams);
    if (moved) return NextResponse.redirect(new URL(moved, request.url), 308);
  }

  const split = appHostRedirect(hostname, path);
  if (split) {
    const dest = request.nextUrl.clone();
    dest.protocol = "https";
    dest.host = split.host;
    dest.port = "";
    dest.pathname = split.pathname;
    return NextResponse.redirect(dest, 308);
  }

  return adminGate(request, path) || NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
