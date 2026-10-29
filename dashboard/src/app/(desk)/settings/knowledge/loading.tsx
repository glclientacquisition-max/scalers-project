import { Skeleton } from "@/components/ui/Skeleton";
import { settingsConsoleClass, settingsPanelClass, settingsRailWrapClass } from "@/components/settingsUi";

export default function Loading() {
  return (
    <div className="w-full min-w-0 overflow-x-clip" data-settings-console="" aria-busy="true" aria-label="Loading catalogue">
      <div className={settingsConsoleClass}>
        <div className={settingsRailWrapClass} aria-hidden="true">
          <Skeleton className="mt-4 h-9 w-full rounded-xl" />
        </div>
        <div className={`${settingsPanelClass} md:max-w-2xl xl:max-w-desk`}>
          <Skeleton className="h-8 w-36" />
          <Skeleton className="mt-6 h-12 w-full rounded-xl" />
          <Skeleton className="mt-3 h-48 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
