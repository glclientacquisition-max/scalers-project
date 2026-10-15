import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { SmartImportPanel } from "@/components/settings/SmartImportPanel";
import { smartItemsLocally } from "@/lib/smartImport/extract";
import { parseSmartImportJson } from "@/lib/smartImport/schema";
import { diffImport } from "@/lib/smartImport/diffImport";
import { savedSettingsFor } from "@/lib/smartImport/saved";
import { defaultHoursSchedule } from "@/lib/hoursSchedule";
import type { TenantRow } from "@/lib/supabase";

/**
 * Smart import preview with fixtures (no sign-in, no model, no writes). DASHBOARD_OPEN=true only.
 * ?fixture=menu (mocked model output for a menu photo) | pricelist (local parser on a pasted list) | upload | empty
 */
const tenant = {
  id: "dev-smart-import",
  business_name: "Mama Oliech Kitchen",
  vertical: "retail",
  services_offered: "",
  services_catalog: [],
  product_catalog: [
    { id: "prd_chapati", name: "Chapati (1pc)", price: "30", sku: "", category: "", unit: "", in_stock: "", notes: "", aliases: [] },
    { id: "prd_chips", name: "Chips mayai", price: "250", sku: "", category: "", unit: "", in_stock: "", notes: "", aliases: [] },
  ],
  faqs: [{ question: "Do you deliver?", answer: "Yes, around Kilimani." }],
  business_locations: [{ label: "Main", address: "Ngong Road, Kilimani", landmark: "", directions: "", coverage_notes: "" }],
  service_areas: { version: 1, areas: [{ id: "place:kilimani", modes: ["delivery"], fee_mode: "fixed", fee_ksh: 100, source: "owner", confirmed: true }], reach: "deliver" },
  business_policies: {},
  hours_schedule: defaultHoursSchedule("Ngong Road, Kilimani"),
  social_handles: { channels: [{ kind: "phone", label: "Main", value: "0700 111 222" }] },
} as unknown as TenantRow;

const MENU_MODEL_OUTPUT = {
  items: [
    { target: "profile", profile_field: "business_name", text: "Mama Oliech Kitchen", confidence: "high", evidence: "MAMA OLIECH KITCHEN" },
    { target: "profile", profile_field: "phone", text: "0712 345 678", confidence: "high", evidence: "Call/WhatsApp 0712 345 678" },
    { target: "products", name: "Chapati", price: "Ksh 35/=", confidence: "high", evidence: "Chapati 35/=" },
    { target: "products", name: "Chips Mayai", price: "250", confidence: "high", evidence: "Chips Mayai 250" },
    { target: "products", name: "Mutura", price: "100", confidence: "high", evidence: "Mutura 100" },
    { target: "products", name: "Smokie pasua", price: "60", confidence: "medium", evidence: "Smokie pasua 6O" },
    { target: "products", name: "Delivery box", price: "50", confidence: "low", alt_target: "coverage", evidence: "Delivery box 50" },
    { target: "coverage", area: "Kilimani", fee_ksh: 150, confidence: "high", evidence: "Delivery Kilimani 150" },
    { target: "coverage", area: "Kileleshwa", fee_ksh: 200, confidence: "high", evidence: "Kileleshwa 200" },
    { target: "hours", days: { mon: "07:00-21:00", tue: "07:00-21:00", wed: "07:00-21:00", thu: "07:00-21:00", fri: "07:00-21:00", sat: "08:00-21:00", sun: "closed" }, confidence: "high", evidence: "Open 7am to 9pm, Sunday closed" },
    { target: "payments", text: "Lipa na M-Pesa Till 552211", confidence: "high", evidence: "Till 552211" },
    { target: "faqs", question: "Do you cater for events?", answer: "Yes, order 2 days ahead.", confidence: "high", evidence: "Events catering, order 2 days ahead" },
  ],
};

const PRICE_LIST = `Chapati - 35
Mandazi - 20
Chips mayai - KSh 250
Pilau beef - 350
Tea (cup) - 50
Q: Do you open on Sundays?
A: No, we rest on Sunday.`;

type Props = { searchParams?: Promise<Record<string, string | undefined>> };

export default function DevSmartImportPage(props: Props) {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  return (
    <Suspense fallback={null}>
      <DevSmartImport {...props} />
    </Suspense>
  );
}

async function DevSmartImport({ searchParams }: Props) {
  const fixture = (await searchParams)?.fixture || "menu";
  const { saved, ctx } = savedSettingsFor(tenant);
  const items =
    fixture === "pricelist" ? smartItemsLocally(PRICE_LIST, { retail: true }) : parseSmartImportJson(JSON.stringify(MENU_MODEL_OUTPUT));
  const state =
    fixture === "upload" || fixture === "empty"
      ? undefined
      : {
          ok: true,
          rows: diffImport(items, saved),
          saved,
          ctx: { ...ctx, sourceLabel: `import:${fixture}` },
          source: fixture === "pricelist" ? ("local" as const) : ("gemini" as const),
          message: fixture === "pricelist" ? "Read without AI. Check each row." : undefined,
        };
  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <div className="mx-auto w-full max-w-2xl p-4">
            <SmartImportPanel tenant={tenant} initialState={state} initialMode={fixture === "upload" ? "file" : "paste"} />
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
