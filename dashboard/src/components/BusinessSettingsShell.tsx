"use client";

import type { ReactNode } from "react";

import Link from "next/link";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import {
  ArrowDownTrayIcon,
  BellIcon,
  BuildingStorefrontIcon,
  ClockIcon,
  DocumentTextIcon,
  LanguageIcon,
  MapPinIcon,
  MicrophoneIcon,
  PhoneArrowUpRightIcon,
  QuestionMarkCircleIcon,
  ShoppingBagIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
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

/** One icon per section, keyed like the status map. */
const SETTINGS_ICON: Record<string, typeof ClockIcon> = {
  "train:identity": BuildingStorefrontIcon,
  "train:hours": ClockIcon,
  "train:locations": MapPinIcon,
  "train:policies": DocumentTextIcon,
  catalog: ShoppingBagIcon,
  import: ArrowDownTrayIcon,
  "train:faqs": QuestionMarkCircleIcon,
  "train:tools": MicrophoneIcon,
  "train:pronunciation": LanguageIcon,
  test: PhoneArrowUpRightIcon,
  "train:team": UsersIcon,
  alerts: BellIcon,
};

/** Statuses that ask the owner to act get the attention colour; the rest stay quiet. */
const needsAction = (text: string) => /^(needs|not )/i.test(text);

/**
 * Settings home (phone screen and the md+ right pane) and the md+ rail share this list.
 * Home rows: icon, name, one plain line, status. Rail rows: name and status only.
 */
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
      className={isRail ? settingsRailClass : "grid min-w-0 w-full gap-6 xl:grid-cols-2 xl:items-start xl:gap-x-8"}
    >
      {isRail ? (
        <Link
          href="/settings"
          className="mb-4 flex min-h-11 items-center rounded-lg px-1 text-title text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          Settings
        </Link>
      ) : null}
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={isRail && index > 0 ? "mt-6" : undefined}>
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
                      isRail ? "" : "min-h-16",
                      deskShiftClass,
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand",
                      active ? "bg-accent-tonal" : "hover:bg-surface-2 active:bg-surface-2",
                    ].join(" ")}
                  >
                    {isRail ? (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    ) : (
                      <>
                        <SettingsRowIcon statusKey={key} />
                        <span className="min-w-0 flex-1 py-2">
                          <span className="block truncate">{item.label}</span>
                          <span className="block text-meta font-normal text-ink-2">{item.description}</span>
                        </span>
                      </>
                    )}
                    {statusText ? (
                      <span
                        title={status?.title || statusText}
                        className={`max-w-[40%] shrink-0 truncate text-meta font-normal tabular-nums ${needsAction(statusText) ? "text-attention" : "text-ink-2"}`}
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

function SettingsRowIcon({ statusKey }: { statusKey: string }) {
  const Icon = SETTINGS_ICON[statusKey] ?? DocumentTextIcon;
  return (
    <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-tonal text-accent">
      <Icon className="h-5 w-5" />
    </span>
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
  membersSlot = null,
  structuredSlot = null,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  optionStatus?: Record<string, SettingsListStatus>;
  liveTransferExecutor?: boolean;
  membersSlot?: ReactNode;
  structuredSlot?: Partial<Record<"identity" | "catalog", ReactNode>> | null;
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
