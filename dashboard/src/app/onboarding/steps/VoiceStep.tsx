"use client";

import { LIMITS, type FieldErrors, type VoiceStep as Value } from "@/lib/setupFlow";
import { ChoiceList, FieldError, inputClass } from "./ui";

export function VoiceStep({
  value,
  onChange,
  errors,
  businessName,
}: {
  value: Value;
  onChange: (v: Value) => void;
  errors: FieldErrors;
  businessName: string;
}) {
  const name = value.agentName.trim();
  const greeting =
    value.tone === "professional"
      ? `Good morning, ${businessName}.${name ? ` ${name} speaking.` : ""} How may I help you?`
      : `Hi, you've reached ${businessName}.${name ? ` I'm ${name}.` : ""} How can I help?`;
  return (
    <>
      <section className="mt-6">
        <div className="rounded-2xl bg-surface p-4">
          <label htmlFor="agentName" className="mb-1.5 block text-meta font-medium text-ink">
            Name
          </label>
          <input
            id="agentName"
            data-field="agentName"
            value={value.agentName}
            maxLength={LIMITS.agentName}
            onChange={(e) => onChange({ ...value, agentName: e.target.value })}
            placeholder="e.g. Wanjiru"
            autoComplete="off"
            aria-invalid={errors.agentName ? true : undefined}
            aria-describedby={errors.agentName ? "agentName-err" : "agentName-hint"}
            className={inputClass}
          />
          {errors.agentName ? (
            <FieldError id="agentName-err" message={errors.agentName} />
          ) : (
            <p id="agentName-hint" className="mt-1.5 text-meta text-ink-2">
              Callers hear this name when the call is answered.
            </p>
          )}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-4 text-meta font-medium text-ink-2">Tone</h2>
        <ChoiceList
          label="Tone"
          value={value.tone}
          onChange={(tone) => onChange({ ...value, tone })}
          options={[
            { value: "warm", title: "Warm", detail: "Friendly and brief." },
            { value: "professional", title: "Professional", detail: "Calm and to the point." },
          ]}
        />
        <p className="mt-2 px-4 text-meta text-ink-2" aria-live="polite">
          Example: &ldquo;{greeting}&rdquo;
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 px-4 text-meta font-medium text-ink-2">When a caller needs you</h2>
        <ChoiceList
          label="When a caller needs you"
          // Callbacks only: Scalers does not put callers through live. A saved
          // live_transfer preference still shows as the callback choice.
          value="callback"
          onChange={(handoff) => onChange({ ...value, handoff })}
          options={[
            { value: "callback", title: "Take a message for a callback", detail: "Your Business Assistant takes their name and reason, then alerts you on WhatsApp, with SMS as backup." },
          ]}
        />
      </section>
    </>
  );
}
