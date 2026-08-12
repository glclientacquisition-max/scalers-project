"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm, type SettingsPanel } from "@/components/TenantForm";
import { TenantSettingsSaveButton } from "@/components/TenantSettingsSaveButton";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";

const PRIMARY_NAV = [
  { id: "today", label: "Today" },
  { id: "catalog", label: "Catalog" },
  { id: "import", label: "Import" },
  { id: "test", label: "Test" },
] as const;

export type BusinessSettingsTab =
  | (typeof PRIMARY_NAV)[number]["id"]
  | "train";

const TRAIN_PANELS: { id: SettingsPanel; label: string }[] = [
  { id: "identity", label: "Agent Persona" },
  { id: "hours", label: "Business Hours" },
  { id: "team", label: "Escalation Team" },
  { id: "faqs", label: "FAQs" },
  { id: "tools", label: "Tools & voice" },
];

function settingsHref(tab: BusinessSettingsTab, panel?: SettingsPanel) {
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (tab === "train" && panel) q.set("panel", panel);
  return `/settings?${q.toString()}`;
}

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

/**
 * Business settings: sticky header save, unified sidebar, one panel at a time.
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

  return (
    <div className="max-w-5xl">
      <header className="sticky top-16 z-30 -mx-4 mb-8 flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface-canvas/95 px-4 py-4 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
            Business
          </h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            Line{" "}
            <span className="font-medium text-ink">
              {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
            </span>
          </p>
        </div>
        {showForm ? <TenantSettingsSaveButton /> : null}
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav aria-label="Business sections" className="shrink-0 lg:w-56">
          <ul className="space-y-1 rounded-2xl border border-line bg-surface p-2">
            {PRIMARY_NAV.slice(0, 2).map((item) => (
              <li key={item.id}>
                <Link
                  href={settingsHref(item.id)}
                  aria-current={tab === item.id ? "page" : undefined}
                  className={navLinkClass(tab === item.id)}
                >
                  {item.label}
                </Link>
              </li>
            ))}

            <li className="pt-2">
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Train
              </p>
              <ul className="space-y-0.5">
                {TRAIN_PANELS.map((sub) => {
                  const subActive = tab === "train" && trainPanel === sub.id;
                  return (
                    <li key={sub.id}>
                      <Link
                        href={settingsHref("train", sub.id)}
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
                  href={settingsHref(item.id)}
                  aria-current={tab === item.id ? "page" : undefined}
                  className={navLinkClass(tab === item.id)}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 flex-1">
          {tab === "today" ? <DailyBulletinPanel tenant={tenant} /> : null}

          {tab === "import" ? (
            <div className="space-y-8">
              <KnowledgeIngestPanel tenant={tenant} />
              <CatalogImportPanel tenant={tenant} />
            </div>
          ) : null}

          {tab === "test" ? (
            <section className="rounded-2xl border border-[#0096FF]/30 bg-[#0096FF]/5 p-6">
              <h2 className="font-display text-2xl tracking-tight text-[#005ccc]">
                Test line
              </h2>
              {pendingDid ? (
                <p className="mt-3 text-sm text-ink-soft">Number pending.</p>
              ) : (
                <p className="mt-3 text-sm text-ink">
                  Call{" "}
                  <a
                    href={`tel:${tenant.sautikit_virtual_number}`}
                    className="font-display text-xl font-medium text-[#005ccc] underline decoration-[#0096FF]/40 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {tenant.sautikit_virtual_number}
                  </a>
                </p>
              )}
            </section>
          ) : null}

          {showForm ? (
            <div>
              {heading ? (
                <h2 className="mb-6 font-display text-2xl tracking-tight text-ink">
                  {heading}
                </h2>
              ) : null}

              <TenantForm
                key={[
                  tenant.id,
                  Array.isArray(tenant.services_catalog)
                    ? tenant.services_catalog.length
                    : 0,
                  Array.isArray(tenant.product_catalog)
                    ? tenant.product_catalog.length
                    : 0,
                  Array.isArray(tenant.faqs) ? tenant.faqs.length : 0,
                  Array.isArray(tenant.team_directory) ? tenant.team_directory.length : 0,
                  String(tenant.llm_system_prompt || "").length,
                  tenant.vertical || "",
                  JSON.stringify(tenant.social_handles || {}),
                ].join(":")}
                tenant={tenant}
                panel={formPanel}
                curatedVoices={curatedVoices}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function parseBusinessSettingsTab(raw: string | undefined | null): BusinessSettingsTab {
  if (raw === "catalog" || raw === "train" || raw === "import" || raw === "test") {
    return raw;
  }
  return "today";
}

export function parseBusinessSettingsPanel(raw: string | undefined | null): SettingsPanel {
  if (
    raw === "identity" ||
    raw === "hours" ||
    raw === "team" ||
    raw === "faqs" ||
    raw === "tools"
  ) {
    return raw;
  }
  return "identity";
}
