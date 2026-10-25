import { NextResponse, type NextRequest } from "next/server";

/**
 * Phone-alert deep link for a new booking (src/notifications/pushFormat.js sends /bookings/<id>).
 * There is no booking detail page yet, so this lands on the Appointments list.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const to = new URL("/appointments", req.url);
  to.searchParams.set("booking", id.slice(0, 64));
  return NextResponse.redirect(to, 307);
}
