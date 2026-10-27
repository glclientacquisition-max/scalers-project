"use client";

import { AreaPicker } from "@/components/areas/AreaPicker";
import { saveAreaPicksAction } from "@/app/(desk)/settings/areas/actions";
import type { AreaPicks } from "@/lib/areaPicks";

/** Onboarding reuses the same Service areas picker as Settings. */
export function OnboardingAreasPanel({
  initialPicks,
  oldList,
  homeCounty = null,
}: {
  initialPicks: AreaPicks;
  oldList: string[];
  /** county:<slug> from what the owner typed so far, or null for every county. */
  homeCounty?: string | null;
}) {
  return (
    <div
      className="-mx-2 min-h-[min(70dvh,640px)]"
      data-area-picker=""
      // The picker sits inside the onboarding form. Enter in its search box must
      // not submit the whole wizard; picks save through the picker's own action.
      onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
        }
      }}
    >
      <AreaPicker
        initialPicks={initialPicks}
        oldList={oldList}
        confirmed={false}
        initialView={oldList.length ? "check" : "home"}
        saveAction={saveAreaPicksAction}
        homeCounty={homeCounty}
      />
    </div>
  );
}
