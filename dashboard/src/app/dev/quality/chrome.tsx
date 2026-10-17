"use client";

import type { ReactNode } from "react";
import { AdminChromeProvider, AdminShell } from "@/components/AdminNav";

function adminPath(pathname: string) {
  if (pathname === "/dev/quality" || pathname.startsWith("/dev/quality/")) {
    return `/admin${pathname.slice("/dev".length)}`;
  }
  return pathname;
}

function harnessHref(href: string) {
  if (href === "/admin/quality" || href.startsWith("/admin/quality/")) {
    return `/dev${href.slice("/admin".length)}`;
  }
  return href;
}

/** Real Admin shell. Quality stays the active destination, and its links stay on the fixture. */
export function DevQualityChrome({ children }: { children: ReactNode }) {
  return (
    <AdminChromeProvider path={adminPath} href={harnessHref}>
      <AdminShell operatorName="ops">{children}</AdminShell>
    </AdminChromeProvider>
  );
}
