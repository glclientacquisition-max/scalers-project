"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm } from "@/components/TenantForm";
import { TestLinePanel } from "@/components/TestLinePanel";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import {
  businessSettingsHref,
  type BusinessSettingsTab,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";
import { settingsStickyHeaderClass } from "@/components/settingsUi";

const PRIMARY_NAV = [
  { id: "updates" as const, label: "Updates" },
  { id: "catalog" as const, label: "Catalog" },
  { id: "import" as const, label: "Import" },
  { id: "test" as const, label: "Test" },
];

const TRAIN_PANELS: { id: SettingsPanel; label: string }[] = [
  { id: "identity", label: "Agent Persona" },
  { id: "hours", label: "Hours" },
  { id: "locations", label: "Locations" },
  { id: "policies", label: "Policies" },
  { id: "team", label: "Escalation Team" },
  { id: "faqs", label: "FAQs" },
  { id: "tools", label: "Tools & voice" },
  { id: "pronunciation", label: "Pronunciation" },
];

type NavItem =
  | { kind: "tab"; id: BusinessSettingsTab; label: string; href: string }
  | { kind: "panel"; id: SettingsPanel; label: string; href: string };

function allNavItems(): NavItem[] {
  return [
    {
      kind: "tab",
      id: "updates",
      label: "Updates",
      href: businessSettingsHref("updates"),
    },
    {
      kind: "tab",
      id: "catalog",
      label: "Catalog",
      href: businessSettingsHref("catalog"),
    },
    ...TRAIN_PANELS.map((sub) => ({
      kind: "panel" as const,
      id: sub.id,
      label: sub.label,
      href: businessSettingsHref("train", sub.id),
    })),
    {
      kind: "tab",
      id: "import",
      label: "Import",
      href: businessSettingsHref("import"),
    },
    {
      kind: "tab",
      id: "test",
      label: "Test",
      href: businessSettingsHref("test"),
    },
  ];
}

function navLinkClass(active: boolean) {
  return [
    "block rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    active
      ? "bg-[#0096FF]/10 text-[#005ccc]"
      : "text-ink-soft hover:bg-surface hover:text-ink",
  ].join(" ");
}

function chipNavClass(active: boolean) {
  return [
    "inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    active
      ? "border-transparent bg-[#0096FF]/10 text-[#005ccc] ring-1 ring-[#0096FF]"
      : "border-line bg-surface text-ink-soft hover:border-[#0096FF]/40 hover:text-ink",
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
    <p className="mt-0.5 text-sm text-ink-soft [overflow-wrap:anywhere]">
      Line{" "}
      <span className="font-medium text-ink">
        {pendingDid ? "Pending assignment" : tenant.sautikit_virtual_number}
      </span>
    </p>
  );
}

function itemActive(
  item: NavItem,
  tab: BusinessSettingsTab,
  trainPanel: SettingsPanel
): boolean {
  if (item.kind === "tab") return tab === item.id;
  return tab === "train" && trainPanel === item.id;
}

function SettingsSidebar({
  tab,
  trainPanel,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
}) {
  const items = allNavItems();

  return (
    <>
      {/* Progressive disclosure: horizontal chips below lg */}
      <nav aria-label="Business sections" className="min-w-0 lg:hidden">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {items.map((item) => {
            const active = itemActive(item, tab, trainPanel);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={chipNavClass(active)}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Full sidebar from lg up */}
      <nav aria-label="Business sections" className="hidden shrink-0 lg:block lg:w-56">
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
            <p className="pointer-events-none mt-4 mb-2 select-none px-3 text-xs font-bold uppercase tracking-wider text-ink-soft">
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
    </>
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
    <div className="w-full min-w-0 max-w-5xl">
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
          <header className={settingsStickyHeaderClass}>
            <div className="min-w-0">
              <h1 className="font-display tracking-tight text-ink text-[clamp(1.5rem,4vw,1.875rem)]">
                Business
              </h1>
              <BusinessLine tenant={tenant} />
            </div>
          </header>

          <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
            <SettingsSidebar tab={tab} trainPanel={trainPanel} />

            <div className="min-w-0 flex-1">
              {tab === "updates" ? <DailyBulletinPanel tenant={tenant} /> : null}

              {tab === "import" ? (
                <div className="space-y-6">
                  <KnowledgeIngestPanel tenant={tenant} />
                  <CatalogImportPanel tenant={tenant} />
                </div>
              ) : null}

              {tab === "test" ? (
                <TestLinePanel tenant={tenant} curatedVoices={curatedVoices} />
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
