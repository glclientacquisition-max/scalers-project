"use client";

import { BusinessCategoryPicker } from "@/components/structured/BusinessCategoryPicker";
import { CallFactsCorrection } from "@/components/structured/CallFactsCorrection";
import { PaymentsEditor } from "@/components/structured/PaymentsEditor";
import { PriceConfirmCards } from "@/components/structured/PriceConfirmCards";
import { parsePaymentsText, parsePriceText, type StructuredPrice } from "@/lib/structuredData";

const ok = async () => {
  await new Promise((r) => setTimeout(r, 400));
  return { ok: true as const, message: "Saved." };
};

const parsed = (text: string): StructuredPrice => ({ ...parsePriceText(text), in_stock: null, source: "parsed", confirmed: false });

export function StructuredFixture({ view, vertical }: { view: string; vertical: "retail" | "home_services" }) {
  if (view === "call" || view === "call-lost" || view === "call-viewer") {
    return (
      <div className="mx-auto w-full max-w-md space-y-6">
        <CallFactsCorrection
          callId="dev-call"
          canEdit={view !== "call-viewer"}
          facts={view === "call-lost" ? { intent: "price_check", outcome: "lost", lost_reason: "price_too_high", source: "owner" } : { intent: "availability", outcome: "info_only", lost_reason: null, source: "review" }}
          save={ok}
        />
      </div>
    );
  }
  const items =
    vertical === "home_services"
      ? [
          { kind: "service" as const, name: "Deep cleaning, 2 bedroom", text: "KSh 4,500 - 6,000", pricing: parsed("KSh 4,500 - 6,000") },
          { kind: "service" as const, name: "Sofa cleaning", text: "from 1500 per seat", pricing: parsed("from 1500 per seat") },
          { kind: "service" as const, name: "Fumigation", text: "depends on size", pricing: parsed("depends on size") },
        ]
      : [
          { kind: "product" as const, name: "A4 printing paper, 500 sheets", text: "650/=", pricing: parsed("650/=") },
          { kind: "product" as const, name: "Samsung Galaxy A15 128GB", text: "KES 18,999", pricing: parsed("KES 18,999") },
          { kind: "product" as const, name: "Exercise books, 96 pages", text: "ask", pricing: parsed("ask") },
        ];
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BusinessCategoryPicker businessType={vertical} initial={null} canEdit save={ok} />
      <PriceConfirmCards items={items} canEdit save={ok} />
      <PaymentsEditor
        initial={parsePaymentsText(vertical === "home_services" ? "Paybill 247247 account your phone. 50% deposit before we start" : "M-Pesa till 123456 or cash on delivery")}
        canEdit
        save={ok}
      />
    </div>
  );
}
