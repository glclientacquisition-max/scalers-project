"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm, type SettingsPanel } from "@/components/TenantForm";
import { TenantSettingsSaveButton } from "@/components/TenantSettingsSaveButton";

const TABS = [
  { id: "today", label: "Today" },
  { id: "catalog", label: "Catalog" },
  { id: "train", label: "Train" },
  { id: "import", label: "Import" },
  { id: "test", label: "Test" },
] as const;

export type BusinessSettingsTab = (typeof TABS)[number]["id"];

const TRAIN_PANELS: { id: SettingsPanel; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "hours", label: "Hours" },
  { id: "team", label: "Team" },
  { id: "faqs", label: "FAQs" },
  { id: "tools", label: "Tools & voice" },
];

function settingsHref(tab: BusinessSettingsTab, panel?: SettingsPanel) {
  const q = new URLSearchParams();
  q.set("tab", tab);
  if (tab === "train" && panel) q.set("panel", panel);
  return `/settings?${q.toString()}`;
}

function navLinkClass(active: boolean, nested = false) {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    nested ? "pl-6" : "",
    active
      ? "bg-[#0096FF]/10 text-[#005ccc]"
      : "text-ink-soft hover:bg-surface hover:text-ink",
  ].join(" ");
}

/**
 * Business settings: vertical sidebar navigation and header-anchored save.
 */
export function BusinessSettingsShell({
  tenant,
  tab,
  trainPanel,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
}) {
  const pendingDid = String(tenant.sautikit_virtual_number || "").startsWith("pending:");
  const formPanel: SettingsPanel =
    tab === "catalog" ? "catalog" : tab === "train" ? trainPanel : "identity";
  const showForm = tab === "catalog" || tab === "train";

  return (
    <div className="max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
            Business
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Line{" "}
            <span className="font-medium text-ink">
              {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
            </span>
          </p>
        </div>
        {showForm ? <TenantSettingsSaveButton /> : null}
      </header>

      <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav
          aria-label="Business sections"
          className="shrink-0 lg:w-52"
        >
          <ul className="space-y-0.5 rounded-2xl border border-line bg-surface p-2">
            {TABS.map((item) => {
              const active = tab === item.id;
              return (
                <li key={item.id}>
                  <Link
                    href={settingsHref(item.id, item.id === "train" ? trainPanel : undefined)}
                    aria-current={active ? "page" : undefined}
                    className={navLinkClass(active)}
                  >
                    {item.label}
                  </Link>
                  {item.id === "train" ? (
                    <ul className="mt-0.5 space-y-0.5">
                      {TRAIN_PANELS.map((sub) => {
                        const subActive = tab === "train" && trainPanel === sub.id;
                        return (
                          <li key={sub.id}>
                            <Link
                              href={settingsHref("train", sub.id)}
                              aria-current={subActive ? "page" : undefined}
                              className={navLinkClass(subActive, true)}
                            >
                              {sub.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
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
                Test your receptionist
              </h2>
              {pendingDid ? (
                <p className="mt-3 text-sm text-ink-soft">
                  Number pending. Test when the line is assigned.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink">
                  Call{" "}
                  <a
                    href={`tel:${tenant.sautikit_virtual_number}`}
                    className="font-display text-xl font-medium text-[#005ccc] underline decoration-[#0096FF]/40 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {tenant.sautikit_virtual_number}
                  </a>{" "}
                  from another phone.
                </p>
              )}
            </section>
          ) : null}

          {showForm ? (
            <div className="mt-0">
              {tab === "catalog" ? (
                <h2 className="mb-6 font-display text-2xl tracking-tight text-ink">
                  Catalog
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
