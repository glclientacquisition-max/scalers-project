"use client";

import { SettingsGroup } from "@/components/settingsUi";
import { AutoGrowTextarea } from "@/components/ui/TextField";
import { SegmentedControl } from "@/components/ui/Segmented";
import { controlClass } from "@/components/ui/Field";
import { cx } from "@/lib/cx";
import {
  GREETING_TEXT_MAX,
  composeGreetingPreview,
  type GreetingLanguage,
} from "@/lib/greetingOpening";

const LANGUAGE_ITEMS: Array<{ value: GreetingLanguage; label: string }> = [
  { value: "en", label: "English" },
  { value: "sw", label: "Swahili" },
];

const LANGUAGE_NAME: Record<GreetingLanguage, string> = { en: "English", sw: "Swahili" };

/**
 * Settings › Identity › Greeting. Owner's full greeting (tenants.greeting_text)
 * and its language (tenants.greeting_language), with the opening callers hear.
 * Controlled: TenantForm owns the values and posts them with the Identity save.
 */
export function GreetingSettings({
  text,
  onText,
  language,
  onLanguage,
  businessName,
  spokenName,
  agentName,
  greetingInvite,
  error,
}: {
  text: string;
  onText: (next: string) => void;
  /** "" while the stored value is NULL and the owner has not picked one. */
  language: GreetingLanguage | "";
  onLanguage: (next: GreetingLanguage) => void;
  businessName: string;
  spokenName: string;
  agentName: string;
  greetingInvite: string;
  error?: string | null;
}) {
  const preview = composeGreetingPreview({
    greetingText: text,
    greetingLanguage: language || null,
    businessName,
    spokenName,
    agentName,
    greetingInvite,
  });
  // The notice sits where Voice speaks it: after the owner's text, or between
  // the name and the invite in the template.
  const at = preview.notice ? preview.text.indexOf(preview.notice) : -1;
  const spoken =
    at < 0
      ? { before: preview.text, after: "" }
      : {
          before: preview.text.slice(0, at).trim(),
          after: preview.text.slice(at + preview.notice.length).trim(),
        };
  const length = text.length;
  const over = length > GREETING_TEXT_MAX;
  const hintId = "greeting_text-hint";
  const countId = "greeting_text-count";

  return (
    <SettingsGroup title="Greeting">
      <div className="space-y-1.5 px-4 py-3">
        <label htmlFor="greeting_text" className="block text-body font-medium text-ink">
          Your greeting
        </label>
        <AutoGrowTextarea
          id="greeting_text"
          value={text}
          onChange={(e) => onText(e.target.value.slice(0, GREETING_TEXT_MAX))}
          maxLength={GREETING_TEXT_MAX}
          rows={2}
          placeholder={preview.usesTemplate ? preview.greeting : undefined}
          aria-invalid={error || over ? true : undefined}
          aria-describedby={[error ? "greeting_text-error" : hintId, countId].join(" ")}
          className={cx(controlClass, "min-h-[4.5rem]")}
        />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {error ? (
              <p id="greeting_text-error" role="alert" className="text-meta text-attention">
                {error}
              </p>
            ) : (
              <p id={hintId} className="text-meta text-ink-2">
                Spoken word for word. Leave empty to use your name and short invite.
              </p>
            )}
          </div>
          <p
            id={countId}
            aria-live="polite"
            className={cx(
              "shrink-0 text-meta tabular-nums",
              length >= GREETING_TEXT_MAX ? "text-attention" : "text-ink-2"
            )}
          >
            {length}/{GREETING_TEXT_MAX}
          </p>
        </div>
      </div>

      <div className="flex min-h-12 w-full flex-wrap items-center gap-3 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p id="greeting_language-label" className="text-body font-medium text-ink">
            Language
          </p>
          {language ? null : (
            <p className="mt-0.5 text-meta text-ink-2">
              Detected from your greeting: {LANGUAGE_NAME[preview.language]}
            </p>
          )}
        </div>
        <SegmentedControl
          label="Greeting language"
          items={LANGUAGE_ITEMS}
          value={language}
          onChange={(v) => onLanguage(v === "sw" ? "sw" : "en")}
          className="shrink-0"
        />
      </div>

      <div className="space-y-1.5 px-4 py-3" data-greeting-preview="">
        <p className="text-meta font-medium text-ink-2">Callers hear</p>
        <p className="text-body leading-relaxed text-ink" aria-live="polite">
          {spoken.before}
          {preview.notice ? <span className="text-ink-2">{spoken.before ? " " : ""}{preview.notice}</span> : null}
          {spoken.after ? ` ${spoken.after}` : null}
        </p>
        {preview.notice ? (
          <p className="text-meta text-ink-2">The recording notice is added while calls are recorded.</p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}
