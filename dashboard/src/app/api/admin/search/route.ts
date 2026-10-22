import { NextRequest, NextResponse } from "next/server";
import { adminGlobalSearch } from "@/lib/adminGlobalSearch";
import { adminCommandSearch } from "@/lib/adminCommandSearch";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  try {
    // ADMIN_V2 ⌘K asks with v=2: grouped businesses, numbers, invoices, calls (archived labelled).
    const v2 = process.env.ADMIN_V2 === "on" && request.nextUrl.searchParams.get("v") === "2";
    const hits = v2 ? await adminCommandSearch(q) : await adminGlobalSearch(q);
    return NextResponse.json({ hits });
  } catch (err) {
    logAdminError("search", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
