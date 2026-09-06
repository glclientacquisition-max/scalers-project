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
  SETTINGS_NAV,
  settingsNavHref,
  settingsNavItemActive,
  settingsPanelHeading,
  type BusinessSettingsTab,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";
import { SettingsPageHeader } from "@/components/settingsUi";

function navLinkClass(active: boolean) {
  return [
    "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]/40",
    active
      ? "bg-[#0096FF]/10 text-[#005ccc]"
      : "text-ink-soft hover:bg-[#0096FF]/[0.04] hover:text-ink active:bg-[#0096FF]/[0.08]",
  ].join(" ");
}

function settingsLineState(did: string | null | undefined): {
  lineLive: boolean;
  lineDetail: string;
} {
  const value = String(did ?? "").trim();
  const lineLive = Boolean(value) && !/^pending:/i.test(value);
  return { lineLive, lineDetail: lineLive ? value : "" };
}

function SettingsSidebar({
  tab,
  trainPanel,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
}) {
  return (
    <nav aria-label="Business sections" className="min-w-0 shrink-0 lg:w-56">
      <ul className="rounded-2xl border border-line bg-surface p-2">
        {SETTINGS_NAV.map((section, index) => (
          <li key={section.id}>
            <p
              className={[
                "pointer-events-none mb-1.5 select-none px-3 text-xs font-bold uppercase tracking-wide text-gray-500",
                index === 0 ? "mt-1" : "mt-4",
              ].join(" ")}
            >
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = settingsNavItemActive(item.target, tab, trainPanel);
                return (
                  <li key={`${item.target.tab}-${item.label}`}>
                    <Link
                      href={settingsNavHref(item.target)}
                      aria-current={active ? "page" : undefined}
                      className={navLinkClass(active)}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
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
  const formPanel: SettingsPanel =
    tab === "catalog" ? "catalog" : tab === "train" ? trainPanel : "identity";
  const showForm = tab === "catalog" || tab === "train";
  const heading = settingsPanelHeading(tab, trainPanel);
  const { lineLive, lineDetail } = settingsLineState(tenant.sautikit_virtual_number);
  const businessName = tenant.business_name?.trim() || "Business";

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
          lineNumber={lineLive ? lineDetail : "Number pending"}
          sidebar={<SettingsSidebar tab={tab} trainPanel={trainPanel} />}
        />
      ) : (
        <>
          <SettingsPageHeader
            businessName={businessName}
            lineLive={lineLive}
            lineDetail={lineDetail}
          />

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
