import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { parseBusinessId, parseWindowDays } from "@/lib/quality/assemble";
import { listReleaseDeltas } from "@/lib/quality/readQuality";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const windowDays = parseWindowDays(params.get("windowDays"));
  if (windowDays == null) {
    return NextResponse.json({ error: "windowDays must be 1 to 30" }, { status: 400 });
  }

  const rawBusiness = params.get("businessId");
  const businessId = rawBusiness ? parseBusinessId(rawBusiness) : null;
  if (rawBusiness && !businessId) {
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await listReleaseDeltas({ windowDays, businessId }));
  } catch (err) {
    logAdminError("quality-releases", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
