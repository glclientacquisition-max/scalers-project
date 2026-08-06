"use client";

import {
  VOICE_LANGUAGE_OPTIONS,
  type VoiceLanguageCode,
} from "@/lib/languages";

type Props = {
  selected: VoiceLanguageCode[];
  onChange: (next: VoiceLanguageCode[]) => void;
  otherLabel: string;
  onOtherLabelChange: (value: string) => void;
  /** When true, render hidden inputs for server actions (signup). */
  formName?: string;
  otherFormName?: string;
};

export function LanguagePicker({
  selected,
  onChange,
  otherLabel,
  onOtherLabelChange,
  formName,
  otherFormName,
}: Props) {
  const showOther = selected.includes("other");

  function toggle(code: VoiceLanguageCode) {
    if (selected.includes(code)) {
      // Keep at least one language.
      if (selected.length === 1) return;
      onChange(selected.filter((c) => c !== code));
      return;
    }
    onChange([...selected, code]);
  }

  return (
    <fieldset className="space-y-3">
      <legend className="block text-sm font-medium text-[var(--ink)]">
        Receptionist languages
      </legend>
      <p className="text-xs text-[var(--ink-soft)] leading-relaxed">
        Pick how the AI should speak with your callers. English &amp; Kiswahili
        have the strongest speech recognition today; Sheng and local languages
        shape replies when callers use them.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {VOICE_LANGUAGE_OPTIONS.map((opt) => {
          const checked = selected.includes(opt.code);
          return (
            <label
              key={opt.code}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                checked
                  ? "border-[var(--accent)] bg-[var(--accent)]/5"
                  : "border-[var(--line)] bg-white hover:border-[var(--accent)]/40"
              }`}
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={checked}
                onChange={() => toggle(opt.code)}
                name={formName}
                value={opt.code}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--ink)]">
                  {opt.label}
                  {opt.speechNative ? (
                    <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-[var(--ink-soft)]">
                      speech
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-[var(--ink-soft)] leading-snug">
                  {opt.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      {showOther ? (
        <div>
          <label
            className="block text-sm font-medium text-[var(--ink)]"
            htmlFor="voice_language_other"
          >
            Other language name
          </label>
          <input
            id="voice_language_other"
            name={otherFormName}
            value={otherLabel}
            onChange={(e) => onOtherLabelChange(e.target.value)}
            required={showOther}
            className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]"
            placeholder="e.g. Turkana, Maasai, Taita…"
          />
        </div>
      ) : null}
    </fieldset>
  );
}
