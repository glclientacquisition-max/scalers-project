import { NextResponse } from "next/server";
import { handlePayWebhook } from "@/lib/invoicePay/webhook";
import { invoicePayLedger } from "@/lib/invoicePay/ledger";
import { bachsMode } from "@/lib/invoicePay/provider";

export async function POST(request: Request) {
  let mode: string;
  try {
    mode = bachsMode();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (mode === "live") {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BACHS_MODE: process.env.BACHS_MODE,
    BACHS_API_KEY: process.env.BACHS_API_KEY,
    BACHS_WEBHOOK_SECRET: process.env.BACHS_WEBHOOK_SECRET,
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
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
      ledger: invoicePayLedger(env),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
