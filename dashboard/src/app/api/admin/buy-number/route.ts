import { NextResponse } from "next/server";
import { adminActorName } from "@/lib/adminActor";
import { recordAdminAction } from "@/lib/adminAudit";
import { logAdminError, operatorError } from "@/lib/adminErrors";
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
    logAdminError("buy-number", { message: "phone line key missing", diagnostics: getSautikitKeyDiagnostics() });
    return NextResponse.json({ error: "Buying is not set up on this server yet." }, { status: 500 });
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
    return NextResponse.json({ error: operatorError("buy-number-list", err, "Could not load numbers to buy.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  if (!isSautikitBuyConfigured()) {
    logAdminError("buy-number", { message: "buy key missing", diagnostics: getSautikitKeyDiagnostics() });
    return NextResponse.json({ error: "Buying is not set up on this server yet." }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const inventoryId = String(body.inventory_id || "");
  if (!inventoryId) {
    return NextResponse.json({ error: "Pick a number to buy." }, { status: 400 });
  }

  try {
    const row = await buyNumberIntoPool(inventoryId);
    await recordAdminAction({
      actor: await adminActorName(),
      action: "buy_number",
      before: null,
      after: { number: (row as { e164?: string } | null)?.e164 ?? null, pool: "available" },
      detail: { inventory_id: inventoryId },
    });
    return NextResponse.json({ ok: true, did: row });
  } catch (err) {
    return NextResponse.json({ error: operatorError("buy-number", err, "Could not buy this number.") }, { status: 500 });
  }
}
