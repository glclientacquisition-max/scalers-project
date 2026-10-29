"use client";

import { policiesFormKey } from "@/lib/serviceAreas";
import { catalogContentKey } from "@/lib/catalogPricing";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { nextFormMountKey, type FormMountKey } from "@/lib/formSave";

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
import { savePoliciesCardAction, savePoliciesUnknownAction } from "@/app/(desk)/settings/policiesCardActions";
import { PoliciesSkeleton } from "@/components/policies/PoliciesSkeleton";

// Each panel is its own chunk, so opening Policies does not download the whole settings form.
const formLoading = () => <Skeleton className="h-96 w-full rounded-2xl" />;
const TenantForm = dynamic(() => import("@/components/TenantForm").then((m) => m.TenantForm), { loading: formLoading });
const IdentitySettings = dynamic(() => import("@/components/identity/IdentitySettings").then((m) => m.IdentitySettings), { loading: formLoading });
const PoliciesSettings = dynamic(() => import("@/components/policies/PoliciesSettings").then((m) => m.PoliciesSettings), {
  loading: () => <PoliciesSkeleton />,
});
import { PoliciesSettingsErrorBoundary } from "@/components/policies/PoliciesSettingsErrorBoundary";
import type { CuratedSonioxVoice } from "@/lib/sonioxVoiceCatalog";
import { resolveTenantBusinessType } from "@/lib/businessType";
import {
  settingsPanelHeading,
  parseBusinessSettingsPanel,
  parseBusinessSettingsTab,
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

/** Client URL wins over a stale server tab during soft navigation (avoids a flash of the Settings home). */
function useResolvedSettingsRoute(serverTab: BusinessSettingsTab, serverTrainPanel: SettingsPanel) {
  const searchParams = useSearchParams();
  return useMemo(() => {
    const tabRaw = searchParams.get("tab");
    const panelRaw = searchParams.get("panel");
    const tabFromUrl = parseBusinessSettingsTab(tabRaw, panelRaw);
    const trainFromUrl = parseBusinessSettingsPanel(panelRaw, tabRaw);
    const tab = tabFromUrl !== "menu" ? tabFromUrl : serverTab;
    const trainPanel = tabFromUrl !== "menu" || tabRaw || panelRaw ? trainFromUrl : serverTrainPanel;
    return { tab, trainPanel };
  }, [searchParams, serverTab, serverTrainPanel]);
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
    return resolveTenantBusinessType(tenant) === "retail" ? (
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
  seatNoteSlot = null,
  structuredSlot = null,
  callsSlot = null,
  assistantSaySlot = null,
  assistantSayPage = false,
  businessCategory = null,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  optionStatus?: Record<string, SettingsListStatus>;
  liveTransferExecutor?: boolean;
  membersSlot?: ReactNode;
  /** Team: one note when every seat is taken. */
  seatNoteSlot?: ReactNode;
  structuredSlot?: Partial<Record<"identity" | "catalog", ReactNode>> | null;
  /** Calls & forwarding (server-built: reads tenants.call_setup and the calls table). */
  callsSlot?: ReactNode;
  assistantSaySlot?: ReactNode;
  assistantSayPage?: boolean;
  /** Identity: tenants.business_category for the one "What you do" question. */
  businessCategory?: string | null;
}) {
  const { tab: activeTab, trainPanel: activeTrainPanel } = useResolvedSettingsRoute(tab, trainPanel);
  const formPanel: SettingsPanel =
    activeTab === "catalog" ? "catalog" : activeTab === "train" ? activeTrainPanel : "identity";
  const showForm = activeTab === "catalog" || activeTab === "train";
  const isMenu = activeTab === "menu";
  const heading = settingsPanelHeading(activeTab, activeTrainPanel, tenant.vertical);
  const { lineLive, lineDetail } = settingsLineState(tenant.sautikit_virtual_number);
  const businessName = tenant.business_name?.trim() || "Business";

  // Panel is part of the key: tenantForSettingsView strips catalogs/policies/etc.
  // per panel, but TenantForm only reads those fields in useState initializers.
  // Without remounting on panel change, Hours → Policies keeps empty openPolicyIds
  // until a hard refresh. Length fingerprints alone miss policies/locations/lexicon.
  const tenantFormScope = `${tenant.id}:${formPanel}`;
  const tenantFormContent = [
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
  // Shared save pattern: the form's own save re-renders the page up to three times
  // (action response, Realtime revalidation, router refresh), and one render can
  // still carry the row from before the write. Keep the mount while it settles,
  // so the fields keep the saved values and the Save button can say Saved.
  const ownSaveAt = useRef(0);
  const markOwnSave = useCallback(() => {
    ownSaveAt.current = Date.now();
  }, []);
  const [formMount, setFormMount] = useState<FormMountKey>(() => ({
    scope: tenantFormScope,
    seen: tenantFormContent,
    mounted: tenantFormContent,
  }));
  if (formMount.scope !== tenantFormScope || formMount.seen !== tenantFormContent) {
    const next = nextFormMountKey(formMount, { scope: tenantFormScope, content: tenantFormContent }, ownSaveAt.current, Date.now());
    if (next !== formMount) setFormMount(next);
  }
  const tenantFormKey = `${formMount.scope}:${formMount.mounted}`;

  const rail = (
    <SettingsRail
      tab={activeTab}
      trainPanel={activeTrainPanel}
      optionStatus={optionStatus}
      assistantSayPage={assistantSayPage}
    />
  );

  if (isMenu) {
    // No section chosen: Settings home on every width, full content width (no rail).
    // Server-rendered with no viewport script, so nothing shifts after paint.
    return (
      <SettingsLeaveGuard>
      <div className="w-full min-w-0 overflow-x-clip" data-settings-console="" data-settings-home="" data-pull-dirty-guard="">
        <div className="w-full min-w-0">
          <div className={`${settingsPanelClass} mx-auto w-full md:max-w-3xl md:pt-4 xl:max-w-6xl`}>
            <SettingsPageHeader
              businessName={businessName}
              lineLive={lineLive}
              lineDetail={lineDetail}
              index
            />
            <SettingsMenu
              tab={activeTab}
              trainPanel={activeTrainPanel}
              variant="index"
              optionStatus={optionStatus}
              assistantSayPage={assistantSayPage}
              vertical={tenant.vertical}
            />
          </div>
        </div>
      </div>
      </SettingsLeaveGuard>
    );
  }

  return (
    <SettingsLeaveGuard>
    <div className="w-full min-w-0 overflow-x-clip" data-settings-console="" data-desk-nested="" data-pull-dirty-guard="">
      {showForm && formPanel === "identity" ? (
        // Identity: three cards that each save on their own (no shared form or Save).
        <IdentitySettings
          key={`${tenant.id}:identity`}
          onSaveActivity={markOwnSave}
          tenant={tenant}
          curatedVoices={curatedVoices}
          heading={heading}
          sidebar={rail}
          businessCategory={businessCategory}
        />
      ) : showForm && formPanel === "policies" ? (
        // Policies: cards that each save on their own, beside what callers hear.
        <PoliciesSettingsErrorBoundary businessName={businessName} heading={heading} sidebar={rail}>
          <PoliciesSettings
            key={`${tenant.id}:policies`}
            onSaveActivity={markOwnSave}
            tenant={tenant}
            curatedVoices={curatedVoices}
            heading={heading}
            sidebar={rail}
            saveCard={savePoliciesCardAction}
            saveUnknown={savePoliciesUnknownAction}
            assistantSayPage={assistantSayPage}
          />
        </PoliciesSettingsErrorBoundary>
      ) : showForm ? (
        <TenantForm
          key={tenantFormKey}
          onSaveActivity={markOwnSave}
          tenant={tenant}
          panel={formPanel}
          curatedVoices={curatedVoices}
          heading={heading}
          sidebar={rail}
          liveTransferExecutor={liveTransferExecutor}
          membersSlot={formPanel === "team" ? membersSlot : null}
          seatNoteSlot={formPanel === "team" ? seatNoteSlot : null}
          structuredSlot={structuredSlot}
        />
      ) : (
        <div className={settingsConsoleClass}>
          {rail}
          <div className={settingsPanelClass}>
            {activeTab === "alerts" ? (
              <AlertsPanel tenant={tenant} businessName={businessName} />
            ) : (
              <>
                <SettingsPageHeader
                  businessName={businessName}
                  lineLive={lineLive}
                  lineDetail={lineDetail}
                  showLine={activeTab === "test"}
                  showBack
                  title={heading}
                />
                {activeTab === "calls" ? callsSlot : null}
                {activeTab === "assistant-say" ? assistantSaySlot : null}
                {activeTab === "import" || activeTab === "test" ? (
                  <SettingsPanelBody
                    tab={activeTab}
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
