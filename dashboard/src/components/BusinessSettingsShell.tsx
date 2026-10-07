"use client";

import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import type { TenantRow } from "@/lib/supabase";
import { AlertsPanel } from "@/components/AlertsPanel";
import { KnowledgeIngestPanel } from "@/components/KnowledgeIngestPanel";
import { CatalogImportPanel } from "@/components/CatalogImportPanel";
import { SettingsLeaveGuard } from "@/components/SettingsLeaveGuard";
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
import {
  settingsStatusKey,
  type SettingsListStatus,
} from "@/lib/settingsOptionStatus";
import {
  SettingsPageHeader,
  settingsConsoleClass,
  settingsPanelClass,
  settingsRailClass,
  settingsRailWrapClass,
} from "@/components/settingsUi";
import { deskShiftClass } from "@/components/ui/deskChrome";
import type { DeskFieldMetaClient } from "@/lib/fieldMetaAttestUi";

function SettingsChevron({ active }: { active: boolean }) {
  return (
    <ChevronRightIcon
      aria-hidden
      className={active ? "size-5 shrink-0 text-ink" : "size-5 shrink-0 text-ink-3"}
    />
  );
}

const settingsMenuRowClass =
  "flex min-h-11 w-full items-center gap-3 px-3 text-body font-medium text-ink";

function SettingsMenu({
  tab,
  trainPanel,
  variant,
  optionStatus,
}: {
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  variant: "index" | "rail";
  optionStatus: Record<string, SettingsListStatus>;
}) {
  const isRail = variant === "rail";
  return (
    <nav
      aria-label="Settings sections"
      data-settings-menu={variant}
      className={isRail ? settingsRailClass : "min-w-0 w-full"}
    >
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={index === 0 ? undefined : "mt-6"}>
          <h2 className="pointer-events-none mb-2 select-none px-1 text-meta font-medium text-ink-2">
            {section.title}
          </h2>
          <ul className="overflow-hidden rounded-2xl border border-hairline bg-surface [&>li:first-child>a]:rounded-t-2xl [&>li:last-child>a]:rounded-b-2xl">
            {section.items.map((item) => {
              const active = settingsNavItemActive(item.target, tab, trainPanel);
              const key = settingsStatusKey(item.target);
              const status = optionStatus[key];
              const statusText = status?.text || "";
              return (
                <li key={key} className="border-b border-hairline last:border-b-0">
                  <Link
                    href={settingsNavHref(item.target)}
                    aria-current={active ? "page" : undefined}
                    className={[
                      settingsMenuRowClass,
                      deskShiftClass,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      active ? "bg-accent-tonal" : "hover:bg-surface-2 active:bg-surface-2",
                    ].join(" ")}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {statusText ? (
                      <span
                        title={status?.title || statusText}
                        className="max-w-[45%] shrink-0 truncate text-meta font-normal tabular-nums text-ink-2"
                      >
                        {statusText}
                      </span>
                    ) : null}
                    <SettingsChevron active={active} />
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
  fieldMeta = null,
  liveTransferExecutor = false,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  optionStatus?: Record<string, SettingsListStatus>;
  fieldMeta?: DeskFieldMetaClient;
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
      <SettingsLeaveGuard>
      <div className="w-full min-w-0 md:hidden" data-settings-console="" data-pull-dirty-guard="">
        <SettingsPageHeader
          businessName={businessName}
          lineLive={lineLive}
          lineDetail={lineDetail}
          index
        />
        <div>
          <SettingsMenu
            tab={tab}
            trainPanel={trainPanel}
            variant="index"
            optionStatus={optionStatus}
          />
        </div>
      </div>
      </SettingsLeaveGuard>
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
    <SettingsLeaveGuard>
    <div className="w-full min-w-0" data-settings-console="" data-desk-nested="" data-pull-dirty-guard="">
      {showForm ? (
        <TenantForm
          key={tenantFormKey}
          tenant={tenant}
          panel={formPanel}
          curatedVoices={curatedVoices}
          fieldMeta={fieldMeta}
          heading={heading}
          sidebar={rail}
          liveTransferExecutor={liveTransferExecutor}
        />
      ) : (
        <div className={settingsConsoleClass}>
          {rail}
          <div className={settingsPanelClass}>
            {tab === "alerts" ? (
              <AlertsPanel tenant={tenant} businessName={businessName} fieldMeta={fieldMeta} />
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
    </SettingsLeaveGuard>
  );
}

export type { BusinessSettingsTab, SettingsPanel } from "@/lib/businessSettingsNav";
export {
  businessSettingsHref,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
} from "@/lib/businessSettingsNav";
