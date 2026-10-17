import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { parseWindowDays } from "@/lib/quality/assemble";
import { listBusinessQuality } from "@/lib/quality/readQuality";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const windowDays = parseWindowDays(new URL(request.url).searchParams.get("windowDays"));
  if (windowDays == null) {
    return NextResponse.json({ error: "windowDays must be 1 to 30" }, { status: 400 });
  }

  try {
    return NextResponse.json(await listBusinessQuality({ windowDays }));
  } catch (err) {
    logAdminError("quality", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
