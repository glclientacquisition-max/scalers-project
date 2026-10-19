import { NextRequest, NextResponse } from "next/server";
import { adminGlobalSearch } from "@/lib/adminGlobalSearch";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(request: NextRequest) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const q = request.nextUrl.searchParams.get("q") || "";
  try {
    const hits = await adminGlobalSearch(q);
    return NextResponse.json({ hits });
  } catch (err) {
    logAdminError("search", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
