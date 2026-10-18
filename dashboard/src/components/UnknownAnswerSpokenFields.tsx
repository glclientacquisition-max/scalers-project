"use client";

import { SettingsStack, settingsFieldClass } from "@/components/settingsUi";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  UNKNOWN_ANSWER_DEFAULT_SW,
} from "@/lib/unknownAnswerSpoken";

const spokenFieldClass = `${settingsFieldClass} min-h-11`;

/** English and Kiswahili lines the caller hears. Placeholders are the team defaults. */
export function UnknownAnswerSpokenFields({
  english,
  swahili,
  onEnglish,
  onSwahili,
  updating,
}: {
  english: string;
  swahili: string;
  onEnglish: (value: string) => void;
  onSwahili: (value: string) => void;
  updating: boolean;
}) {
  return (
    <div data-unknown-spoken="" aria-busy={updating || undefined}>
      {updating ? <p className="px-4 pt-3 text-meta text-ink-3">Updating</p> : null}
      <div className={updating ? "opacity-60" : undefined}>
        <SettingsStack label="English" htmlFor="unknown_answer_spoken_en">
          <textarea
            id="unknown_answer_spoken_en"
            value={english}
            rows={2}
            maxLength={220}
            placeholder={UNKNOWN_ANSWER_DEFAULT_EN}
            onChange={(event) => onEnglish(event.target.value)}
            className={spokenFieldClass}
          />
        </SettingsStack>
        <SettingsStack label="Kiswahili" htmlFor="unknown_answer_spoken_sw">
          <textarea
            id="unknown_answer_spoken_sw"
            value={swahili}
            rows={2}
            maxLength={220}
            placeholder={UNKNOWN_ANSWER_DEFAULT_SW}
            onChange={(event) => onSwahili(event.target.value)}
            className={spokenFieldClass}
          />
        </SettingsStack>
      </div>
    </div>
  );
}
