import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { parseBusinessId, parseCallLimit } from "@/lib/quality/assemble";
import { getBusinessQuality } from "@/lib/quality/readQuality";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ businessId: string }> },
) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const { businessId: rawId } = await context.params;
  const businessId = parseBusinessId(rawId);
  if (!businessId) {
    return NextResponse.json({ error: "business_id required" }, { status: 400 });
  }

  const limit = parseCallLimit(new URL(request.url).searchParams.get("limit"));
  if (limit == null) {
    return NextResponse.json({ error: "limit must be 1 to 100" }, { status: 400 });
  }

  try {
    const body = await getBusinessQuality({ businessId, limit });
    if (!body) {
      return NextResponse.json({ error: "No business." }, { status: 404 });
    }
    return NextResponse.json(body);
  } catch (err) {
    logAdminError("quality-business", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
