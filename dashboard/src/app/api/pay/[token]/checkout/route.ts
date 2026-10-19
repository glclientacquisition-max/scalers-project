import { NextResponse } from "next/server";
import { startInvoiceCheckout } from "@/lib/invoicePay/checkoutFlow";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { assertBachsAllowed, checkoutFailure, payProviderFromEnv } from "@/lib/invoicePay/provider";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const origin = new URL(request.url).origin;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BACHS_MODE: process.env.BACHS_MODE,
    BACHS_API_KEY: process.env.BACHS_API_KEY,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  try {
    assertBachsAllowed(env);
  } catch (err) {
    const failed = checkoutFailure(err);
    return NextResponse.json({ error: failed.error }, { status: failed.status });
  }
  try {
    const result = await startInvoiceCheckout({
      token,
      origin,
      ledger: invoicePayLedger(),
      provider: payProviderFromEnv(env),
    });
    const response = NextResponse.json(
      { checkoutUrl: result.checkoutUrl, checkoutId: result.checkoutId },
      { headers: { "Cache-Control": "no-store" } }
    );
    response.cookies.set("scalers_pay", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/pay",
      maxAge: 60 * 60,
    });
    return response;
  } catch (err) {
    const failed = checkoutFailure(err);
    return NextResponse.json({ error: failed.error }, { status: failed.status });
  }
}
