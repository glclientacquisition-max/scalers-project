import { readFileSync } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { businessTypeLabel, resolveBusinessType, type BusinessType } from "@/lib/businessType";

export const instant = false;

type Hours = {
  days?: Record<string, { open: string; close: string } | null>;
};

type CatalogueItem = { name: string; price?: string; price_range?: string };

type Tenant = {
  slug: string;
  public_key: string;
  business_name: string;
  business_type: string;
  business_hours: string;
  hours_schedule?: Hours;
  faqs?: unknown[];
  services_catalog?: CatalogueItem[];
  product_catalog?: CatalogueItem[];
};

const DAY = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function hoursLine(hours: Hours | undefined): string {
  const days = hours?.days || {};
  return DAY.map((key) => {
    const slot = days[key];
    if (!slot) return `${key} closed`;
    return `${key} ${slot.open}-${slot.close}`;
  }).join(", ");
}

export default function DemoTenantsPreview() {
  if (process.env.DASHBOARD_OPEN !== "true") notFound();
  const file = path.join(process.cwd(), "..", "fixtures", "demo-tenants.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { tenants: Tenant[] };
  return (
    <main className="min-h-dvh bg-canvas px-4 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-page tracking-tight">Demo tenants</h1>
          <p className="text-meta text-ink-2">Staging fixture. Not a public page. Nothing is written from here.</p>
        </header>
        {parsed.tenants.map((tenant) => {
          const type = resolveBusinessType({ business_type: tenant.business_type });
          const items = tenant.business_type === "retail" ? tenant.product_catalog || [] : tenant.services_catalog || [];
          return (
            <section key={tenant.slug} className="rounded-2xl bg-surface p-4">
              <h2 className="text-title tracking-tight">{tenant.business_name}</h2>
              <p className="mt-1 text-body text-ink-2">
                {businessTypeLabel(type as BusinessType)} · {tenant.public_key}
              </p>
              <p className="mt-3 text-body">{tenant.business_hours}</p>
              <p className="mt-1 text-meta text-ink-2">{hoursLine(tenant.hours_schedule)}</p>
              <p className="mt-3 text-meta tabular-nums text-ink-2">
                {(tenant.faqs || []).length} FAQs · {items.length} catalogue rows
              </p>
              <ul className="mt-3 flex flex-col gap-2">
                {items.map((item) => (
                  <li key={item.name} className="flex items-baseline justify-between gap-3 text-body">
                    <span className="min-w-0">{item.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-2">{item.price || item.price_range}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
