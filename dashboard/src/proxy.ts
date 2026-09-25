import { NextRequest, NextResponse } from "next/server";
import {
  configuredAdminHost,
  configuredAppHost,
  hostnameOf,
  isAdminHostAllowedPath,
  isAdminHostName,
  isLoopbackHost,
} from "@/lib/adminHost";

export function proxy(request: NextRequest) {
  const hostname = hostnameOf(request.headers.get("host"));
  const adminHost = configuredAdminHost();
  const path = request.nextUrl.pathname;

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
    return NextResponse.next();
  }

  if (adminHost && !isLoopbackHost(hostname) && path.startsWith("/admin")) {
    const dest = request.nextUrl.clone();
    dest.protocol = "https";
    dest.host = adminHost;
    dest.port = "";
    return NextResponse.redirect(dest);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
