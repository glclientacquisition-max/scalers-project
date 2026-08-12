"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm } from "@/components/TenantForm";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import {
  businessSettingsHref,
  type BusinessSettingsTab,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";

const PRIMARY_NAV = [
  { id: "today", label: "Today" },
  { id: "catalog", label: "Catalog" },
  { id: "import", label: "Import" },
  { id: "test", label: "Test" },
] as const;

const TRAIN_PANELS: { id: SettingsPanel; label: string }[] = [
  { id: "identity", label: "Agent Persona" },
  { id: "hours", label: "Business Hours" },
  { id: "team", label: "Escalation Team" },
  { id: "faqs", label: "FAQs" },
  { id: "tools", label: "Tools & voice" },
];

function navLinkClass(active: boolean) {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    active
      ? "bg-[#0096FF]/10 text-[#005ccc]"
      : "text-ink-soft hover:bg-surface hover:text-ink",
  ].join(" ");
}

function panelHeading(tab: BusinessSettingsTab, trainPanel: SettingsPanel): string | null {
  if (tab === "catalog") return "Catalog";
  if (tab === "train") {
    return TRAIN_PANELS.find((p) => p.id === trainPanel)?.label ?? "Train";
  }
  return null;
}

function BusinessLine({ tenant }: { tenant: TenantRow }) {
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");
  return (
    <p className="mt-0.5 text-sm text-ink-soft">
      Line{" "}
      <span className="font-medium text-ink">
        {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
      </span>
    </p>
  );
}

function SettingsSidebar({
  tab,
  trainPanel,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
}) {
  return (
    <nav aria-label="Business sections" className="shrink-0 lg:w-56">
      <ul className="space-y-1 rounded-2xl border border-line bg-surface p-2">
        {PRIMARY_NAV.slice(0, 2).map((item) => (
          <li key={item.id}>
            <Link
              href={businessSettingsHref(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={navLinkClass(tab === item.id)}
            >
              {item.label}
            </Link>
          </li>
        ))}

        <li>
          <p className="mt-6 mb-2 px-3 text-xs font-bold uppercase tracking-wider text-gray-500 pointer-events-none select-none">
            Train
          </p>
          <ul className="space-y-0.5">
            {TRAIN_PANELS.map((sub) => {
              const subActive = tab === "train" && trainPanel === sub.id;
              return (
                <li key={sub.id}>
                  <Link
                    href={businessSettingsHref("train", sub.id)}
                    aria-current={subActive ? "page" : undefined}
                    className={navLinkClass(subActive)}
                  >
                    {sub.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </li>

        {PRIMARY_NAV.slice(2).map((item) => (
          <li key={item.id}>
            <Link
              href={businessSettingsHref(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              className={navLinkClass(tab === item.id)}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Business settings: sticky header save inside the form tree, unified sidebar.
 */
export function BusinessSettingsShell({
  tenant,
  tab,
  trainPanel,
  curatedVoices = [],
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
}) {
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");
  const formPanel: SettingsPanel =
    tab === "catalog" ? "catalog" : tab === "train" ? trainPanel : "identity";
  const showForm = tab === "catalog" || tab === "train";
  const heading = panelHeading(tab, trainPanel);

  const tenantFormKey = [
    tenant.id,
    Array.isArray(tenant.services_catalog) ? tenant.services_catalog.length : 0,
    Array.isArray(tenant.product_catalog) ? tenant.product_catalog.length : 0,
    Array.isArray(tenant.faqs) ? tenant.faqs.length : 0,
    Array.isArray(tenant.team_directory) ? tenant.team_directory.length : 0,
    String(tenant.llm_system_prompt || "").length,
    tenant.vertical || "",
    JSON.stringify(tenant.social_handles || {}),
  ].join(":");

  return (
    <div className="max-w-5xl">
      {showForm ? (
        <TenantForm
          key={tenantFormKey}
          tenant={tenant}
          panel={formPanel}
          curatedVoices={curatedVoices}
          heading={heading}
          lineNumber={
            pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number || ""
          }
          sidebar={<SettingsSidebar tab={tab} trainPanel={trainPanel} />}
        />
      ) : (
        <>
          <header className="sticky top-0 z-20 -mx-4 mb-8 border-b border-line bg-surface-canvas/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
            <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
              Business
            </h1>
            <BusinessLine tenant={tenant} />
          </header>

          <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
            <SettingsSidebar tab={tab} trainPanel={trainPanel} />

            <div className="min-w-0 flex-1">
              {tab === "today" ? <DailyBulletinPanel tenant={tenant} /> : null}

              {tab === "import" ? (
                <div className="space-y-8">
                  <KnowledgeIngestPanel tenant={tenant} />
                  <CatalogImportPanel tenant={tenant} />
                </div>
              ) : null}

              {tab === "test" ? (
                <section className="rounded-2xl border border-[#0096FF]/30 bg-[#0096FF]/5 p-6 sm:p-8">
                  <h2 className="font-display text-2xl tracking-tight text-[#005ccc]">
                    Test line
                  </h2>
                  {pendingDid ? (
                    <p className="mt-3 text-sm text-ink-soft">Number pending.</p>
                  ) : (
                    <div className="mt-6">
                      <p className="text-sm text-ink-soft">
                        Call your receptionist from this device.
                      </p>
                      <a
                        href={`tel:${tenant.sautikit_virtual_number}`}
                        className="mt-4 flex min-h-[4.5rem] w-full items-center justify-center rounded-2xl bg-[#0096FF] px-6 py-5 text-center font-display text-2xl font-semibold tracking-tight text-white shadow-sm transition hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40 focus-visible:ring-offset-2 sm:text-3xl"
                      >
                        {tenant.sautikit_virtual_number}
                      </a>
                    </div>
                  )}
                </section>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export type { BusinessSettingsTab, SettingsPanel } from "@/lib/businessSettingsNav";
export {
  businessSettingsHref,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
