"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { AlertsPanel } from "@/components/AlertsPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { TenantForm } from "@/components/TenantForm";
import { TestLinePanel } from "@/components/TestLinePanel";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { parseVertical } from "@/lib/vertical";
import {
  SETTINGS_NAV,
  settingsNavHref,
  settingsNavItemActive,
  settingsPanelHeading,
  type BusinessSettingsTab,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";
import { settingsStatusKey } from "@/lib/settingsOptionStatus";
import {
  SettingsPageHeader,
  settingsConsoleClass,
  settingsGroupTitleClass,
  settingsPanelClass,
  settingsRailClass,
  settingsRailWrapClass,
} from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";

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
  optionStatus,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  variant: "index" | "rail";
  optionStatus: Record<string, string>;
}) {
  const isRail = variant === "rail";
  const railListClass = "w-max max-w-full space-y-0.5";
  const railLinkClass =
    "inline-flex min-h-11 w-full items-center justify-start gap-2 border-l-2 px-3 text-sm font-medium";
  return (
    <nav
      aria-label="Settings sections"
      data-settings-menu={variant}
      className={isRail ? settingsRailClass : "min-w-0 w-full"}
    >
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={index === 0 ? undefined : "mt-4"}>
          <h2 className={`${settingsGroupTitleClass} mb-1 px-1`}>{section.title}</h2>
          <ul className={isRail ? railListClass : "w-full"}>
            {section.items.map((item) => {
              const active = settingsNavItemActive(item.target, tab, trainPanel);
              const key = settingsStatusKey(item.target);
              const status = optionStatus[key] || "";
              return (
                <li key={key} className={isRail ? undefined : "border-b border-line"}>
                  <Link
                    href={settingsNavHref(item.target)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      isRail
                        ? `${railLinkClass} ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`
                        : `flex min-h-12 w-full items-center gap-3 px-1 text-sm font-medium ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`,
                      active
                        ? isRail
                          ? "border-accent text-accent-deep"
                          : "text-accent-deep"
                        : isRail
                          ? "border-transparent text-ink hover:bg-accent/[0.04] active:bg-accent/[0.08]"
                          : "text-ink hover:bg-accent/[0.04] active:bg-accent/[0.08]",
                    ].join(" ")}
                  >
                    <span className={isRail ? "max-w-[7.5rem] truncate" : "min-w-0 flex-1 truncate"}>
                      {item.label}
                    </span>
                    {status ? (
                      <span
                        title={status}
                        className={
                          isRail
                            ? "max-w-[5.5rem] shrink-0 truncate text-xs font-normal text-ink-soft"
                            : "max-w-[45%] shrink-0 truncate text-sm font-normal text-ink-soft"
                        }
                      >
                        {status}
                      </span>
                    ) : null}
                    {isRail ? null : <SettingsChevron />}
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

function SettingsPanelBody({
  tab,
  tenant,
  curatedVoices,
}: {
  tab: "import" | "test";
  tenant: TenantRow;
  curatedVoices: CuratedSonioxVoice[];
}) {
  if (tab === "import") {
    return parseVertical(tenant.vertical) === "retail" ? (
      <CatalogImportPanel tenant={tenant} />
    ) : (
      <KnowledgeIngestPanel tenant={tenant} />
    );
  }
  return <TestLinePanel tenant={tenant} curatedVoices={curatedVoices} />;
}

/**
 * Business settings: phone index then drill-in. md+ inner rail beside a fluid panel.
 */
export function BusinessSettingsShell({
  tenant,
  tab,
  trainPanel,
  curatedVoices = [],
  optionStatus = {},
  liveTransferExecutor = false,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  optionStatus?: Record<string, string>;
  liveTransferExecutor?: boolean;
}) {
  const formPanel: SettingsPanel =
    tab === "catalog" ? "catalog" : tab === "train" ? trainPanel : "identity";
  const showForm = tab === "catalog" || tab === "train";
  const isMenu = tab === "menu";
  const heading = settingsPanelHeading(tab, trainPanel, tenant.vertical);
  const { lineLive, lineDetail } = settingsLineState(tenant.sautikit_virtual_number);
  const businessName = tenant.business_name?.trim() || "Business";

  // Panel is part of the key: tenantForSettingsView strips catalogs/policies/etc.
  // per panel, but TenantForm only reads those fields in useState initializers.
  // Without remounting on panel change, Hours → Policies keeps empty openPolicyIds
  // until a hard refresh. Length fingerprints alone miss policies/locations/lexicon.
  const tenantFormKey = [
    tenant.id,
    formPanel,
    Array.isArray(tenant.services_catalog) ? tenant.services_catalog.length : 0,
    Array.isArray(tenant.product_catalog) ? tenant.product_catalog.length : 0,
    Array.isArray(tenant.faqs) ? tenant.faqs.length : 0,
    Array.isArray(tenant.team_directory) ? tenant.team_directory.length : 0,
    Array.isArray(tenant.business_locations) ? tenant.business_locations.length : 0,
    Array.isArray(tenant.tts_lexicon) ? tenant.tts_lexicon.length : 0,
    JSON.stringify(tenant.business_policies || {}),
    String(tenant.llm_system_prompt || "").length,
    tenant.vertical || "",
    JSON.stringify(tenant.social_handles || {}),
  ].join(":");

  if (isMenu) {
    return (
      <div className="w-full min-w-0 md:hidden" data-settings-console="" data-pull-dirty-guard="">
        <SettingsPageHeader
          businessName={businessName}
          lineLive={lineLive}
          lineDetail={lineDetail}
          index
        />
        <div className="mt-4">
          <SettingsMenu
            tab={tab}
            trainPanel={trainPanel}
            variant="index"
            optionStatus={optionStatus}
          />
        </div>
      </div>
    );
  }

  const rail = (
    <div className={settingsRailWrapClass}>
      <SettingsMenu
        tab={tab}
        trainPanel={trainPanel}
        variant="rail"
        optionStatus={optionStatus}
      />
    </div>
  );

  return (
    <div className="w-full min-w-0" data-settings-console="" data-desk-nested="" data-pull-dirty-guard="">
      {showForm ? (
        <TenantForm
          key={tenantFormKey}
          tenant={tenant}
          panel={formPanel}
          curatedVoices={curatedVoices}
          heading={heading}
          sidebar={rail}
          liveTransferExecutor={liveTransferExecutor}
        />
      ) : (
        <div className={settingsConsoleClass}>
          {rail}
          <div className={settingsPanelClass}>
            {tab === "alerts" ? (
              <AlertsPanel tenant={tenant} businessName={businessName} />
            ) : (
              <>
                <SettingsPageHeader
                  businessName={businessName}
                  lineLive={lineLive}
                  lineDetail={lineDetail}
                  showLine={tab === "test"}
                  showBack
                  title={heading}
                />
                {tab === "import" || tab === "test" ? (
                  <SettingsPanelBody
                    tab={tab}
                    tenant={tenant}
                    curatedVoices={curatedVoices}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>
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
