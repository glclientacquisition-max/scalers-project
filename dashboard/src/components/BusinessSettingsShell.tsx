"use client";

import { policiesFormKey } from "@/lib/serviceAreas";
import { catalogContentKey } from "@/lib/catalogPricing";
import type { ReactNode } from "react";

import type { TenantRow } from "@/lib/supabase";
import { AlertsPanel } from "@/components/AlertsPanel";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/Skeleton";

// Heavy panels load only when their section opens (keeps them out of the Settings home and form bundle).
const panelLoading = () => <Skeleton className="h-64 w-full rounded-2xl" />;
const KnowledgeIngestPanel = dynamic(() => import("@/components/KnowledgeIngestPanel").then((m) => m.KnowledgeIngestPanel), { loading: panelLoading });
const CatalogImportPanel = dynamic(() => import("@/components/CatalogImportPanel").then((m) => m.CatalogImportPanel), { loading: panelLoading });
const TestLinePanel = dynamic(() => import("@/components/TestLinePanel").then((m) => m.TestLinePanel), { loading: panelLoading });
import { SettingsLeaveGuard } from "@/components/SettingsLeaveGuard";
import { TenantForm } from "@/components/TenantForm";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { parseVertical } from "@/lib/vertical";
import {
  settingsPanelHeading,
  type BusinessSettingsTab,
  type SettingsPanel,
} from "@/lib/businessSettingsNav";
import { type SettingsListStatus } from "@/lib/settingsOptionStatus";
import {
  SettingsPageHeader,
  settingsConsoleClass,
  settingsPanelClass,
} from "@/components/settingsUi";
import { SettingsMenu, SettingsRail } from "@/components/SettingsSideNav";

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
  membersSlot = null,
  structuredSlot = null,
  callsSlot = null,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  optionStatus?: Record<string, SettingsListStatus>;
  liveTransferExecutor?: boolean;
  membersSlot?: ReactNode;
  structuredSlot?: Partial<Record<"identity" | "catalog", ReactNode>> | null;
  /** Calls & forwarding (server-built: reads tenants.call_setup and the calls table). */
  callsSlot?: ReactNode;
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
    // Catalogue content, not lengths: a price confirm changes no length, and a form that kept
    // the old rows would post them back on Save and undo the confirm.
    catalogContentKey(tenant.services_catalog, tenant.product_catalog),
    Array.isArray(tenant.faqs) ? tenant.faqs.length : 0,
    Array.isArray(tenant.team_directory) ? tenant.team_directory.length : 0,
    Array.isArray(tenant.business_locations) ? tenant.business_locations.length : 0,
    Array.isArray(tenant.tts_lexicon) ? tenant.tts_lexicon.length : 0,
    policiesFormKey(tenant.business_policies),
    String(tenant.llm_system_prompt || "").length,
    tenant.vertical || "",
    JSON.stringify(tenant.social_handles || {}),
  ].join(":");

  const rail = (
    <SettingsRail tab={tab} trainPanel={trainPanel} optionStatus={optionStatus} />
  );

  if (isMenu) {
    // No section chosen: Settings home on every width, full content width (no rail).
    // Server-rendered with no viewport script, so nothing shifts after paint.
    return (
      <SettingsLeaveGuard>
      <div className="w-full min-w-0" data-settings-console="" data-settings-home="" data-pull-dirty-guard="">
        <div className="w-full min-w-0">
          <div className={`${settingsPanelClass} mx-auto w-full md:max-w-3xl md:pt-4 xl:max-w-6xl`}>
            <SettingsPageHeader
              businessName={businessName}
              lineLive={lineLive}
              lineDetail={lineDetail}
              index
            />
            <SettingsMenu
              tab={tab}
              trainPanel={trainPanel}
              variant="index"
              optionStatus={optionStatus}
            />
          </div>
        </div>
      </div>
      </SettingsLeaveGuard>
    );
  }

  return (
    <SettingsLeaveGuard>
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
          membersSlot={formPanel === "team" ? membersSlot : null}
          structuredSlot={structuredSlot}
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
                {tab === "calls" ? callsSlot : null}
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
