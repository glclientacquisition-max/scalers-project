import type { ReactNode } from "react";
import { SettingsRail } from "@/components/SettingsSideNav";
import { settingsConsoleClass } from "@/components/settingsUi";
import { PageHeader } from "@/components/ui/PageHeader";

/** Plan and Billing keep the settings rail on desktop. Phone leads with Back. */
export function SettingsPlanFrame({
  title,
  meta,
  activePath,
  children,
}: {
  title: string;
  meta?: string | null;
  /** Fixture only. Live pages read the pathname. */
  activePath?: string;
  children: ReactNode;
}) {
  return (
    <div data-desk-nested="" className={`${settingsConsoleClass} min-h-full flex-1`}>
      <SettingsRail activePath={activePath} />
      <div className="flex min-h-full w-full min-w-0 flex-1 flex-col md:max-w-3xl">
        <PageHeader
          title={title}
          meta={meta || undefined}
          back={{ href: "/settings", label: "Settings" }}
        />
        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}
