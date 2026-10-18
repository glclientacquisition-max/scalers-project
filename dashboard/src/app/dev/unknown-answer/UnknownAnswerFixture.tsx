"use client";

import { useState } from "react";
import { DeskRail, DeskTabBar, deskMainClass, deskShellClass } from "@/components/DeskNav";
import { UnknownAnswerField } from "@/components/UnknownAnswerField";
import { SettingsGroup, settingsFormBodyClass } from "@/components/settingsUi";
import { UNKNOWN_ANSWER_DEFAULT_EN } from "@/lib/unknownAnswerSpoken";

const OWNER_LINE = "If we do not stock it, a teammate will call the caller back.";
const OWNER_SPOKEN = {
  en: "If we do not stock it, a teammate will call you back.",
  sw: "Tukikosa bidhaa hiyo, mwenzetu atakupigia.",
};

/** Policies "When unsure" block, for layout screenshots. DASHBOARD_OPEN only. */
export function UnknownAnswerFixture({ edited, updating }: { edited: boolean; updating: boolean }) {
  const [text, setText] = useState(edited ? OWNER_LINE : UNKNOWN_ANSWER_DEFAULT_EN);
  const [english, setEnglish] = useState(edited ? OWNER_SPOKEN.en : "");
  const [swahili, setSwahili] = useState(edited ? OWNER_SPOKEN.sw : "");

  return (
    <div className={deskShellClass}>
      <DeskRail needsCount={0} homeHref="/dev/home" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:overflow-hidden">
        <main data-desk-main="" className={deskMainClass}>
          <div className={`${settingsFormBodyClass} min-w-0 px-4 py-6`} data-unknown-answer="">
            <SettingsGroup title="When unsure">
              <UnknownAnswerField
                text={text}
                onText={setText}
                onReset={() => {
                  setText(UNKNOWN_ANSWER_DEFAULT_EN);
                  setEnglish("");
                  setSwahili("");
                }}
                english={english}
                swahili={swahili}
                onEnglish={setEnglish}
                onSwahili={setSwahili}
                updating={updating}
              />
            </SettingsGroup>
          </div>
        </main>
        <DeskTabBar needsCount={0} />
      </div>
    </div>
  );
}
