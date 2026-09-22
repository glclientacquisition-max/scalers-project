"use client";

import Link from "next/link";
import type { TenantRow } from "@/lib/supabase";
import { DailyBulletinPanel } from "@/components/DailyBulletinPanel";
import { AlertsPanel } from "@/components/AlertsPanel";
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
import {
  SettingsGroup,
  SettingsPageHeader,
  settingsConsoleClass,
  settingsGroupTitleClass,
  settingsPanelClass,
  settingsPanelHeadingClass,
  settingsRailClass,
  settingsRailWrapClass,
} from "@/components/settingsUi";
import { ThemePicker } from "@/components/ThemePicker";
import { SignOutButton } from "@/components/ui/SignOutButton";
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

function AppearancePanel({ showHeading = true }: { showHeading?: boolean }) {
  return (
    <section className="min-w-0 w-full space-y-6">
      {showHeading ? <h2 className={settingsPanelHeadingClass}>Appearance</h2> : null}
      <SettingsGroup title="This device">
        <div className="px-4 py-2">
          <ThemePicker />
        </div>
      </SettingsGroup>
    </section>
  );
}

function SettingsSignOutRow() {
  return (
    <li className="border-t border-line">
      <div className="flex min-h-12 items-center px-2">
        <SignOutButton />
      </div>
    </li>
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
      aria-label="Business Profile sections"
      data-settings-menu={variant}
      className={isRail ? settingsRailClass : "min-w-0 w-full"}
    >
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={index === 0 ? undefined : "mt-6"}>
          <h2 className={`${settingsGroupTitleClass} mb-1.5 px-1`}>{section.title}</h2>
          {isRail ? (
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = settingsNavItemActive(item.target, tab, trainPanel, {
                  selectHubAppearance: true,
                });
                const key =
                  item.target.tab === "train"
                    ? `${item.target.tab}-${item.target.panel}`
                    : item.target.tab;
                return (
                  <li key={key}>
                    <Link
                      href={settingsNavHref(item.target)}
                      aria-current={active ? "page" : undefined}
                      className={[
                        `flex min-h-11 items-center border-l-2 px-3 text-sm font-medium ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`,
                        active
                          ? "border-accent text-accent-deep"
                          : "border-transparent text-ink hover:bg-accent/[0.04] active:bg-accent/[0.08]",
                      ].join(" ")}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              {section.id === "device" ? (
                <li className="px-1 pt-1">
                  <SignOutButton />
                </li>
              ) : null}
            </ul>
          ) : (
            <ul className="w-full overflow-hidden rounded-xl border border-line bg-surface">
              {section.items.map((item, itemIndex) => {
                const active = settingsNavItemActive(item.target, tab, trainPanel);
                const key =
                  item.target.tab === "train"
                    ? `${item.target.tab}-${item.target.panel}`
                    : item.target.tab;
                return (
                  <li
                    key={key}
                    className={itemIndex === 0 ? undefined : "border-t border-line"}
                  >
                    <Link
                      href={settingsNavHref(item.target)}
                      aria-current={active ? "page" : undefined}
                      className={[
                        `flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium ${deskShiftClass} focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent`,
                        active
                          ? "bg-accent/10 text-accent-deep"
                          : "text-ink hover:bg-accent/[0.04] active:bg-accent/[0.08]",
                      ].join(" ")}
                    >
                      {item.label}
                      <SettingsChevron />
                    </Link>
                  </li>
                );
              })}
              {section.id === "device" ? <SettingsSignOutRow /> : null}
            </ul>
          )}
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
  tab: Exclude<BusinessSettingsTab, "menu" | "catalog" | "train" | "alerts">;
  tenant: TenantRow;
  curatedVoices: CuratedSonioxVoice[];
}) {
  if (tab === "updates") return <DailyBulletinPanel tenant={tenant} />;
  if (tab === "import") {
    return (
      <div className="space-y-6">
        <KnowledgeIngestPanel tenant={tenant} />
        <CatalogImportPanel tenant={tenant} />
      </div>
    );
  }
  if (tab === "test") {
    return <TestLinePanel tenant={tenant} curatedVoices={curatedVoices} />;
  }
  return <AppearancePanel showHeading={false} />;
}

/**
 * Business settings: phone index then drill-in. md+ inner rail beside a fluid panel.
 */
export function BusinessSettingsShell({
  tenant,
  tab,
  trainPanel,
  curatedVoices = [],
  liveTransferExecutor = false,
}: {
  tenant: TenantRow;
  tab: BusinessSettingsTab;
  trainPanel: SettingsPanel;
  curatedVoices?: CuratedSonioxVoice[];
  liveTransferExecutor?: boolean;
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

  const rail = (
    <div className={settingsRailWrapClass}>
      <SettingsMenu tab={tab} trainPanel={trainPanel} variant="rail" />
    </div>
  );

  if (isMenu) {
    return (
      <div className="w-full min-w-0" data-settings-console="">
        <SettingsPageHeader
          businessName={businessName}
          lineLive={lineLive}
          lineDetail={lineDetail}
          index
        />
        <div className={settingsConsoleClass}>
          {rail}
          <div className={settingsPanelClass}>
            <div className="md:hidden">
              <SettingsMenu tab={tab} trainPanel={trainPanel} variant="index" />
            </div>
            <div className="hidden md:block">
              <AppearancePanel />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0" data-settings-console="">
      {showForm ? (
        <TenantForm
          key={tenantFormKey}
          tenant={tenant}
          panel={formPanel}
          curatedVoices={curatedVoices}
          heading={heading}
          lineNumber={lineLive ? lineDetail : "Number pending"}
          sidebar={rail}
          liveTransferExecutor={liveTransferExecutor}
        />
      ) : (
        <div className={settingsConsoleClass}>
          {rail}
          <div className={settingsPanelClass}>
            {tab === "alerts" ? (
              <AlertsPanel
                tenant={tenant}
                businessName={businessName}
                lineLive={lineLive}
                lineDetail={lineDetail}
              />
            ) : (
              <>
                <SettingsPageHeader
                  businessName={businessName}
                  lineLive={lineLive}
                  lineDetail={lineDetail}
                  showBack
                  title={heading}
                />
                {tab === "updates" ||
                tab === "import" ||
                tab === "test" ||
                tab === "appearance" ? (
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
