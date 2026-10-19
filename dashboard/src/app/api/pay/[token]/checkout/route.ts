import { NextResponse } from "next/server";
import { startInvoiceCheckout } from "@/lib/invoicePay/checkoutFlow";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { payProviderFromEnv } from "@/lib/invoicePay/provider";

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
    const result = await startInvoiceCheckout({
      token,
      origin,
      ledger: invoicePayLedger(env),
      provider: payProviderFromEnv(env),
    });
    return NextResponse.json(
      { checkoutUrl: result.checkoutUrl, checkoutId: result.checkoutId },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Could not start payment." }, { status: 400 });
  }
}
