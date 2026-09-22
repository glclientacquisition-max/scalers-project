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
import { SettingsPageHeader, settingsPanelHeadingClass } from "@/components/settingsUi";
import { ThemePicker } from "@/components/ThemePicker";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { deskShiftClass } from "@/components/ui/deskChrome";

const SETTINGS_GROUP_TITLE_CLASS =
  "pointer-events-none mb-1.5 select-none px-1 text-xs font-bold uppercase tracking-wide text-gray-500";

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

function AppearancePanel() {
  return (
    <section className="min-w-0 space-y-4">
      <h2 className={settingsPanelHeadingClass}>Appearance</h2>
      <ThemePicker />
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
      className={
        isRail
          ? "min-w-0 shrink-0 lg:sticky lg:top-4 lg:w-56"
          : "min-w-0 w-full"
      }
    >
      {SETTINGS_NAV.map((section, index) => (
        <section key={section.id} className={index === 0 ? undefined : "mt-6"}>
          <h2 className={SETTINGS_GROUP_TITLE_CLASS}>{section.title}</h2>
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
                        `flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`,
                        active
                          ? "bg-accent/10 text-accent-deep"
                          : "text-ink hover:bg-accent/[0.04] active:bg-accent/[0.08]",
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
            <ul className="overflow-hidden rounded-2xl border border-line bg-surface">
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
                        `flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium ${deskShiftClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`,
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
  tab: Exclude<BusinessSettingsTab, "menu" | "catalog" | "train">;
  tenant: TenantRow;
  curatedVoices: CuratedSonioxVoice[];
}) {
  if (tab === "updates") return <DailyBulletinPanel tenant={tenant} />;
  if (tab === "alerts") return <AlertsPanel tenant={tenant} />;
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
  return <AppearancePanel />;
}

/**
 * Business settings: phone index then drill-in. lg+ sidebar beside the panel.
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
    <div className="hidden min-w-0 lg:block">
      <SettingsMenu tab={tab} trainPanel={trainPanel} variant="rail" />
    </div>
  );

  if (isMenu) {
    return (
      <div className="w-full min-w-0 max-w-5xl">
        <SettingsPageHeader
          businessName={businessName}
          lineLive={lineLive}
          lineDetail={lineDetail}
          index
        />
        <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start">
          {rail}
          <div className="min-w-0 flex-1">
            <div className="lg:hidden">
              <SettingsMenu tab={tab} trainPanel={trainPanel} variant="index" />
            </div>
            <div className="hidden lg:block">
              <AppearancePanel />
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          liveTransferExecutor={liveTransferExecutor}
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
              {tab === "updates" ||
              tab === "alerts" ||
              tab === "import" ||
              tab === "test" ||
              tab === "appearance" ? (
                <SettingsPanelBody
                  tab={tab}
                  tenant={tenant}
                  curatedVoices={curatedVoices}
                />
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
