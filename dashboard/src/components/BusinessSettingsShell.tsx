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

function SettingsChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4 shrink-0 text-ink-soft"
      aria-hidden
    >
      <path
        d="M7.5 4.5 13 10l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsMenu({
  tab,
  trainPanel,
  variant,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  variant: "index" | "rail";
}) {
  const isRail = variant === "rail";
  return (
    <nav
      aria-label="Business sections"
      className={isRail ? "min-w-0 shrink-0 lg:w-60" : "min-w-0 w-full"}
    >
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={index === 0 ? undefined : "mt-6"}>
          <h2 className="pointer-events-none mb-1.5 select-none px-1 text-xs font-bold uppercase tracking-wide text-gray-500">
            {section.title}
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
            {section.items.map((item, itemIndex) => {
              const active = settingsNavItemActive(item.target, tab, trainPanel);
              return (
                <li
                  key={`${item.target.tab}-${item.label}`}
                  className={itemIndex === 0 ? undefined : "border-t border-line"}
                >
                  <Link
                    href={settingsNavHref(item.target)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0096FF]/40",
                      active
                        ? "bg-[#0096FF]/10 text-[#005ccc]"
                        : "text-ink hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.08]",
                    ].join(" ")}
                  >
                    {item.label}
                    <SettingsChevron />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}

function settingsLineState(did: string | null | undefined): {
  lineLive: boolean;
  lineDetail: string;
} {
  const value = String(did ?? "").trim();
  const lineLive = Boolean(value) && !/^pending:/i.test(value);
  return { lineLive, lineDetail: lineLive ? value : "" };
}

/**
 * Business settings: menu of destinations, then one screen.
 * Mobile is list or detail. Desktop keeps the list beside the panel.
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
  const isMenu = tab === "menu";
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

  if (isMenu) {
    return (
      <div className="w-full min-w-0 max-w-5xl">
        <SettingsPageHeader
          businessName={businessName}
          lineLive={lineLive}
          lineDetail={lineDetail}
        />
        <SettingsMenu tab={tab} trainPanel={trainPanel} variant="index" />
      </div>
    );
  }

  const rail = (
    <div className="hidden min-w-0 lg:block">
      <SettingsMenu tab={tab} trainPanel={trainPanel} variant="rail" />
    </div>
  );

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
          sidebar={rail}
        />
      ) : (
        <>
          <SettingsPageHeader
            businessName={businessName}
            lineLive={lineLive}
            lineDetail={lineDetail}
            showBack
          />

          <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
            {rail}
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
