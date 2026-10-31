import type { ReactNode } from "react";
import { SettingsRail } from "@/components/SettingsSideNav";
import { SettingsPageHeader, settingsConsoleClass, settingsPanelClass } from "@/components/settingsUi";
import type { SettingsListStatus } from "@/lib/settingsOptionStatus";

/** Plan and Billing use the same console as every other settings section: rail on md+, Back on the phone. */
export function SettingsPlanFrame({
  title,
  meta,
  activePath,
  optionStatus,
  hideBilling = false,
  children,
}: {
  title: string;
  meta?: string | null;
  /** Fixture only. Live pages read the pathname. */
  activePath?: string;
  optionStatus?: Record<string, SettingsListStatus>;
  hideBilling?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="w-full min-w-0 overflow-x-clip" data-settings-console="" data-desk-nested="">
      <div className={settingsConsoleClass}>
        <SettingsRail activePath={activePath} optionStatus={optionStatus} hideBilling={hideBilling} />
        <div className={`${settingsPanelClass} max-w-[55rem] [&>header]:max-w-none`}>
          <SettingsPageHeader businessName="" lineLive={false} showBack title={title} />
          {meta ? <p className="text-meta text-ink-2">{meta}</p> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
