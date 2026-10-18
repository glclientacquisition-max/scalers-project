"use client";

import { useState } from "react";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { UnknownAnswerSpokenFields } from "@/components/UnknownAnswerSpokenFields";
import { SettingsGroup, SettingsStack, settingsFieldClass, settingsFormBodyClass } from "@/components/settingsUi";
import { UNKNOWN_ANSWER_DEFAULT_EN } from "@/lib/unknownAnswerSpoken";

/** Policies "When unsure" block, for layout screenshots. DASHBOARD_OPEN only. */
export function UnknownAnswerFixture({ updating }: { updating: boolean }) {
  const [fallback, setFallback] = useState(
    "If we do not stock it, a teammate will call the caller back."
  );
  const [english, setEnglish] = useState("If we do not stock it, a teammate will call you back.");
  const [swahili, setSwahili] = useState("Tukikosa, mwenzetu atakupigia.");

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <div className={`${settingsFormBodyClass} min-w-0 px-4 py-6`} data-unknown-answer="">
            <SettingsGroup title="When unsure">
              <SettingsStack label="What to say" htmlFor="unknown_answer_fallback">
                <textarea
                  id="unknown_answer_fallback"
                  value={fallback}
                  rows={3}
                  onChange={(event) => setFallback(event.target.value)}
                  placeholder={UNKNOWN_ANSWER_DEFAULT_EN}
                  className={`${settingsFieldClass} min-h-[5.5rem]`}
                />
              </SettingsStack>
              <UnknownAnswerSpokenFields
                english={english}
                swahili={swahili}
                updating={updating}
                onEnglish={setEnglish}
                onSwahili={setSwahili}
              />
            </SettingsGroup>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
