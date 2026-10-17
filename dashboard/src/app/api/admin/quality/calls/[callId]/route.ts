import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { parseCallId } from "@/lib/quality/assemble";
import { getCallTrace } from "@/lib/quality/readQuality";
import { isLegacyAuthenticated } from "@/lib/auth";

export async function GET(
  _request: Request,
  context: { params: Promise<{ callId: string }> },
) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const { callId: rawId } = await context.params;
  const callId = parseCallId(rawId);
  if (!callId) {
    return NextResponse.json({ error: "call id required" }, { status: 400 });
  }

  try {
    const body = await getCallTrace(callId);
    if (!body) {
      return NextResponse.json({ error: "No trace for that call." }, { status: 404 });
    }
    return NextResponse.json(body);
  } catch (err) {
    logAdminError("quality-call", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
