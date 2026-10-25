"use client";

import { AreaPicker } from "@/components/areas/AreaPicker";
import { saveAreaPicksAction } from "@/app/(desk)/settings/areas/actions";
import type { AreaPicks } from "@/lib/areaPicks";

/** Onboarding reuses the same Service areas picker as Settings. */
export function OnboardingAreasPanel({
  initialPicks,
  oldList,
}: {
  initialPicks: AreaPicks;
  oldList: string[];
}) {
  return (
    <div className="-mx-2 min-h-[min(70dvh,640px)]" data-area-picker="">
      <AreaPicker
        initialPicks={initialPicks}
        oldList={oldList}
        confirmed={false}
        initialView={oldList.length ? "check" : "home"}
        saveAction={saveAreaPicksAction}
      />
    </div>
  );
}
