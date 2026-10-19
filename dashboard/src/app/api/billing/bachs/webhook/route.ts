import { NextResponse } from "next/server";
import { handlePayWebhook } from "@/lib/invoicePay/webhook";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { assertBachsAllowed } from "@/lib/invoicePay/provider";

export async function POST(request: Request) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BACHS_MODE: process.env.BACHS_MODE,
    BACHS_API_KEY: process.env.BACHS_API_KEY,
    BACHS_WEBHOOK_SECRET: process.env.BACHS_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
  try {
    assertBachsAllowed(env);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code || "") : "";
    if (code === "bachs_live_refused" || code === "prod_refused") {
      return NextResponse.json({ ok: false }, { status: 403 });
    }
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const secret = env.BACHS_WEBHOOK_SECRET || "";
  const rawBody = await request.text();
  const headers = {
    "x-bachs-timestamp": request.headers.get("x-bachs-timestamp") || "",
    "x-bachs-signature": request.headers.get("x-bachs-signature") || "",
    "x-bachs-signature-v2": request.headers.get("x-bachs-signature-v2") || "",
  };

  try {
    const result = await handlePayWebhook({
      rawBody,
      headers,
      secret,
      ledger: invoicePayLedger(),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "webhook failed";
    console.error(message);
    if (message.includes("invoice cannot be paid") || message.includes("draft invoices are not payable")) {
      return NextResponse.json({ ok: true }, { status: 200 });
    }
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
