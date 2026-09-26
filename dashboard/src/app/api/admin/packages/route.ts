import { NextResponse } from "next/server";
import { adminFacingError, logAdminError } from "@/lib/adminErrors";
import { isLegacyAuthenticated } from "@/lib/auth";
import {
  assignBusinessPackage,
  loadPackageCatalog,
  parseCount,
  parseDiscountPercent,
  parseMoney,
  saveBillingPackage,
  saveRateCard,
} from "@/lib/packageCatalog";

export async function GET() {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }
  try {
    const catalog = await loadPackageCatalog();
    return NextResponse.json({ ok: true, ...catalog });
  } catch (err) {
    logAdminError("packages-list", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isLegacyAuthenticated())) {
    return NextResponse.json({ error: "ops_only" }, { status: 403 });
  }

  const body = await request.json();
  const action = String(body.action || "");

  try {
    if (action === "save_rates") {
      const inboundKesPerSecond = parseMoney(body.inbound_kes_per_second);
      const outboundKesPerSecond = parseMoney(body.outbound_kes_per_second);
      const whatsappKes = parseMoney(body.whatsapp_kes);
      const smsKes = parseMoney(body.sms_kes);
      const emailKes = parseMoney(body.email_kes);
      const annualDiscountPercent = parseDiscountPercent(body.annual_discount_percent);
      if (
        inboundKesPerSecond === null ||
        outboundKesPerSecond === null ||
        whatsappKes === null ||
        smsKes === null ||
        emailKes === null ||
        annualDiscountPercent === null
      ) {
        return NextResponse.json({ error: "Rates must be zero or more. Discount 0 to 100." }, { status: 400 });
      }
      await saveRateCard({
        inboundKesPerSecond,
        outboundKesPerSecond,
        whatsappKes,
        smsKes,
        emailKes,
        annualDiscountPercent,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "save_package") {
      const id = String(body.id || "");
      const sku = String(body.sku || "");
      const name = String(body.name || "").trim();
      const monthlyPriceKes = parseMoney(body.monthly_price_kes);
      const seats = parseCount(body.seats);
      const minutes = parseCount(body.minutes);
      const sms = parseCount(body.sms);
      const email = parseCount(body.email);
      const staffWa = parseCount(body.staff_wa);
      const dids = parseCount(body.dids);
      const sortOrder = parseCount(body.sort_order);
      if (!id || !sku || !name) {
        return NextResponse.json({ error: "Package id, sku, and name required" }, { status: 400 });
      }
      if (
        monthlyPriceKes === null ||
        seats === null ||
        minutes === null ||
        sms === null ||
        email === null ||
        staffWa === null ||
        dids === null ||
        sortOrder === null
      ) {
        return NextResponse.json({ error: "Package numbers must be zero or more" }, { status: 400 });
      }
      await saveBillingPackage({
        id,
        sku,
        name,
        monthlyPriceKes,
        seats,
        minutes,
        sms,
        email,
        staffWa,
        dids,
        sortOrder,
        isActive: body.is_active !== false,
      });
      return NextResponse.json({ ok: true });
    }

    if (action === "assign") {
      const tenantId = String(body.business_id || "");
      const packageId = String(body.package_id || "");
      const period = String(body.period || "month");
      if (!tenantId || !packageId) {
        return NextResponse.json({ error: "Business and package required" }, { status: 400 });
      }
      if (period !== "month" && period !== "year") {
        return NextResponse.json({ error: "Period must be month or year" }, { status: 400 });
      }
      await assignBusinessPackage({ tenantId, packageId, period });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    logAdminError("packages-save", err);
    return NextResponse.json({ error: adminFacingError(err) }, { status: 500 });
  }
}
