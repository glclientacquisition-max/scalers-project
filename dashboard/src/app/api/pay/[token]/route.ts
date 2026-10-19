import { NextResponse } from "next/server";
import { loadPayView } from "@/lib/invoicePay/loadPay";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const url = new URL(request.url);
  try {
    const view = await loadPayView(token, {
      return: url.searchParams.get("return") || undefined,
      checkout_id: url.searchParams.get("checkout_id") || undefined,
    });
    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load this invoice." }, { status: 503 });
  }
}
