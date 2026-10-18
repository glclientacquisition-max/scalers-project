"use client";

import { Button } from "@/components/ui/Button";
import { CharCount } from "@/components/ui/TextField";
import { ExpandTextarea, SettingsStack, settingsFieldClass } from "@/components/settingsUi";
import { POLICY_TEXT_MAX } from "@/lib/lengthLimits";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  UNKNOWN_ANSWER_DEFAULT_SW,
  ownerUnknownAnswer,
} from "@/lib/unknownAnswerSpoken";

const spokenFieldClass = `${settingsFieldClass} min-h-11`;

/**
 * "When unsure" line. Opens on the team default, which is never stored.
 * Once the owner writes their own line, save returns an English and Kiswahili pair they can edit.
 */
export function UnknownAnswerField({
  text,
  onText,
  onReset,
  english,
  swahili,
  onEnglish,
  onSwahili,
  updating,
}: {
  text: string;
  onText: (value: string) => void;
  onReset: () => void;
  english: string;
  swahili: string;
  onEnglish: (value: string) => void;
  onSwahili: (value: string) => void;
  updating: boolean;
}) {
  const isDefault = !ownerUnknownAnswer(text);
  const showSpoken = !isDefault && (updating || Boolean(english || swahili));

  return (
    <>
      <div className="space-y-1.5 px-4 py-3" data-unknown-answer-line={isDefault ? "default" : "owner"}>
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor="unknown_answer_fallback" className="text-body font-medium text-ink">
            What to say
          </label>
          {isDefault ? (
            <span className="text-meta text-ink-3">Default</span>
          ) : (
            <Button variant="ghost" size="sm" className="-mr-3 text-accent" onClick={onReset}>
              Reset to default
            </Button>
          )}
        </div>
        <ExpandTextarea
          id="unknown_answer_fallback"
          value={text}
          onChange={onText}
          placeholder={UNKNOWN_ANSWER_DEFAULT_EN}
          maxLength={POLICY_TEXT_MAX}
        />
        <div className="mt-1.5 flex items-start justify-between gap-3">
          {isDefault ? (
            <p className="min-w-0 text-meta text-ink-3">
              Kiswahili: <span lang="sw">{UNKNOWN_ANSWER_DEFAULT_SW}</span>
            </p>
          ) : (
            <span />
          )}
          <CharCount length={text.length} max={POLICY_TEXT_MAX} />
        </div>
      </div>
      {showSpoken ? (
        <div data-unknown-spoken="" aria-busy={updating || undefined}>
          <p className="px-4 pt-3 text-meta text-ink-3">{updating ? "Updating" : "Callers hear"}</p>
          <div className={updating ? "opacity-60" : undefined}>
            <SettingsStack label="English" htmlFor="unknown_answer_spoken_en">
              <textarea
                id="unknown_answer_spoken_en"
                value={english}
                rows={2}
                maxLength={220}
                onChange={(event) => onEnglish(event.target.value)}
                className={spokenFieldClass}
              />
            </SettingsStack>
            <SettingsStack label="Kiswahili" htmlFor="unknown_answer_spoken_sw">
              <textarea
                id="unknown_answer_spoken_sw"
                lang="sw"
                value={swahili}
                rows={2}
                maxLength={220}
                onChange={(event) => onSwahili(event.target.value)}
                className={spokenFieldClass}
              />
            </SettingsStack>
          </div>
        </div>
      ) : null}
    </>
  );
}
