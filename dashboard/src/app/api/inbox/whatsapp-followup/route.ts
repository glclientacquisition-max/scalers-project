import { NextResponse } from "next/server";
import { logWhatsAppFollowUp } from "@/app/(desk)/calls/actions";

/** Beacon target for the wa.me tap. Appends the follow-up note; never closes the item. */
export async function POST(request: Request) {
  let callId = "";
  try {
    const body = JSON.parse(await request.text()) as { callId?: unknown };
    callId = String(body?.callId ?? "").trim();
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if (!callId) return NextResponse.json({ error: "Missing call id." }, { status: 400 });
  const res = await logWhatsAppFollowUp(callId);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
