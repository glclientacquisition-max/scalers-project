import { NextResponse } from "next/server";
import { isLegacyAuthenticated } from "@/lib/auth";
import { buyNumberIntoPool } from "@/lib/didPool";
import {
  formatMinor,
  getSautikitKeyDiagnostics,
  isSautikitBuyConfigured,
  isSautikitConfigured,
  listAvailableSautikitNumbers,
} from "@/lib/sautikit";

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!isSautikitConfigured()) {
    return NextResponse.json(
      { error: "SAUTIKIT_API_KEY is not set", diagnostics: getSautikitKeyDiagnostics() },
      { status: 500 }
    );
  }

  try {
    const available = await listAvailableSautikitNumbers();
    return NextResponse.json({
      ok: true,
      buyConfigured: isSautikitBuyConfigured(),
      available: available.slice(0, 40).map((n) => ({
        inventory_id: n.inventory_id,
        e164: n.e164,
        monthly: formatMinor(n.monthly_price_minor, n.currency),
        monthly_price_minor: n.monthly_price_minor,
        currency: n.currency,
        capabilities: n.capabilities,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!isSautikitBuyConfigured()) {
    return NextResponse.json(
      {
        error:
          "Buying requires SAUTIKIT_ADMIN_OPS_KEY (or SAUTIKIT_API_KEY) with numbers.claim scope.",
        diagnostics: getSautikitKeyDiagnostics(),
      },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const inventoryId = String(body.inventory_id || "");
  if (!inventoryId) {
    return NextResponse.json({ error: "inventory_id required" }, { status: 400 });
  }

  try {
    const row = await buyNumberIntoPool(inventoryId);
    return NextResponse.json({ ok: true, did: row });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string }).code;
    const hint =
      code === "api_key.scope_denied" || /numbers\.claim|scope_denied/i.test(message)
        ? " Mint Key B (SAUTIKIT_ADMIN_OPS_KEY) with numbers.claim on Vercel."
        : /insufficient|balance|wallet/i.test(message)
          ? " Top up the SautiKit platform wallet first."
          : "";
    return NextResponse.json({ error: `${message}${hint}`, code: code || null }, { status: 500 });
  }
}
