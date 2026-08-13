"use client";

import { useActionState, useEffect, useState } from "react";
import {
  completeOnboardingAction,
  type OnboardingState,
} from "./actions";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";
import {
  VERTICAL_OPTIONS,
  type BusinessVertical,
} from "@/lib/vertical";
import {
  HANDOFF_OPTIONS,
  type HandoffMode,
} from "@/lib/handoffMode";
import { compactTextareaExpandHandlers } from "@/components/settingsUi";

const STEPS = [
  "Business type",
  "Services & pricing",
  "Hours & location",
  "Tone & handoff",
] as const;

const TONE_OPTIONS: { id: OnboardingTone; blurb: string }[] = [
  {
    id: "professional",
    blurb: "Calm, clear, and polished. Best for clinics, offices, and formal brands.",
  },
  {
    id: "friendly",
    blurb: "Warm and helpful, like a receptionist people enjoy talking to.",
  },
  {
    id: "empathetic",
    blurb: "Steady and caring. Acknowledges frustration before solving.",
  },
  {
    id: "localized",
    blurb: "Natural Kenyan voice with light Sheng when the caller uses it.",
  },
];

const initial: OnboardingState = {};

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [vertical, setVertical] = useState<BusinessVertical | "">("retail");
  const [servicesPricing, setServicesPricing] = useState("");
  const [hoursLocation, setHoursLocation] = useState("");
  const [landmark, setLandmark] = useState("");
  const [directions, setDirections] = useState("");
  const [tone, setTone] = useState<OnboardingTone | "">("");
  const [handoffMode, setHandoffMode] = useState<HandoffMode>("callback");
  const [agentName, setAgentName] = useState("Receptionist");
  const [state, formAction, pending] = useActionState(completeOnboardingAction, initial);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (typeof state.step === "number" && state.step !== step) {
      setStep(state.step);
    }
  }, [state.step, step]);

  function goTo(next: number) {
    setVisible(false);
    window.setTimeout(() => {
      setStep(next);
      setVisible(true);
    }, 160);
  }

  function canAdvance(): boolean {
    if (step === 0) return Boolean(vertical);
    if (step === 1) return servicesPricing.trim().length >= 12;
    if (step === 2) return hoursLocation.trim().length >= 8;
    if (step === 3) return Boolean(tone);
    return false;
  }

  return (
    <div className="mt-10">
      <ol className="flex items-center gap-2 mb-8" aria-label="Setup progress">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                className={[
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium transition-colors duration-300",
                  done
                    ? "bg-[var(--accent)] text-white"
                    : active
                      ? "bg-[var(--accent-deep)] text-white"
                      : "bg-white border border-[var(--line)] text-[var(--ink-soft)]",
                ].join(" ")}
              >
                {i + 1}
              </span>
              <span
                className={[
                  "hidden sm:block text-sm transition-opacity duration-300",
                  active ? "text-[var(--ink)] font-medium" : "text-[var(--ink-soft)]",
                ].join(" ")}
              >
                {label}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  className={[
                    "mx-1 h-px flex-1 transition-colors duration-500",
                    done ? "bg-[var(--accent)]" : "bg-[var(--line)]",
                  ].join(" ")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <form
        action={formAction}
        className={[
          "rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 sm:p-8 shadow-[0_20px_50px_-35px_rgba(28,36,33,0.45)] transition-all duration-300",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2",
        ].join(" ")}
      >
        <input type="hidden" name="vertical" value={vertical} />
        <input type="hidden" name="services_pricing" value={servicesPricing} />
        <input type="hidden" name="hours_location" value={hoursLocation} />
        <input type="hidden" name="landmark" value={landmark} />
        <input type="hidden" name="directions" value={directions} />
        <input type="hidden" name="tone" value={tone} />
        <input type="hidden" name="handoff_mode" value={handoffMode} />
        <input type="hidden" name="agent_name" value={agentName} />

        {step === 0 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Business type</h2>
            <div className="mt-5 space-y-3">
              {VERTICAL_OPTIONS.map((opt) => {
                const selected = vertical === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setVertical(opt.id)}
                    className={[
                      "w-full text-left rounded-xl border px-4 py-4 transition duration-200",
                      selected
                        ? "border-[var(--accent)] bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]"
                        : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                    ].join(" ")}
                  >
                    <span className="font-medium text-[var(--ink)]">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">
              {vertical === "retail" ? "Products & pricing" : "Services & pricing"}
            </h2>
            <textarea
              autoFocus
              value={servicesPricing}
              onChange={(e) => setServicesPricing(e.target.value)}
              rows={2}
              {...compactTextareaExpandHandlers}
              placeholder={
                vertical === "retail"
                  ? "e.g. Phone accessories, chargers, and screen protectors.\nPricing: chargers from 500 KES. We can hold items with a name until evening. M-Pesa and cash."
                  : "e.g. Plumbing repairs, electrical fixes, and deep cleaning across Nairobi.\nPricing: we quote after understanding the job. Call-out from KES 1,500. M-Pesa and cash."
              }
              className="mt-5 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)] leading-relaxed"
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Hours & location</h2>
            <textarea
              autoFocus
              value={hoursLocation}
              onChange={(e) => setHoursLocation(e.target.value)}
              rows={2}
              {...compactTextareaExpandHandlers}
              placeholder={
                "Monday to Saturday: 9:00 AM to 7:00 PM. Sunday: Closed.\nWestlands, Nairobi."
              }
              className="mt-5 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)] leading-relaxed"
            />
            <label className="mt-4 block text-sm font-medium text-[var(--ink)]" htmlFor="landmark">
              Landmark (optional)
            </label>
            <input
              id="landmark"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="Opposite Naivas, next to the Shell"
              className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
            />
            <label
              className="mt-4 block text-sm font-medium text-[var(--ink)]"
              htmlFor="directions"
            >
              Spoken directions (optional)
            </label>
            <textarea
              id="directions"
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              rows={2}
              {...compactTextareaExpandHandlers}
              placeholder="From Waiyaki Way, turn at the Shell. We are on the left."
              className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)] leading-relaxed"
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-8">
            <div>
              <h2 className="font-display text-2xl text-[var(--ink)]">Receptionist name & tone</h2>
              <label
                className="mt-5 block text-sm font-medium text-[var(--ink)]"
                htmlFor="agent_name_field"
              >
                Receptionist name
              </label>
              <input
                id="agent_name_field"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Receptionist"
                className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
              <div className="mt-5 space-y-3">
                {TONE_OPTIONS.map((opt) => {
                  const selected = tone === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setTone(opt.id)}
                      className={[
                        "w-full text-left rounded-xl border px-4 py-4 transition duration-200",
                        selected
                          ? "border-[var(--accent)] bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]"
                          : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                      ].join(" ")}
                    >
                      <span className="font-medium text-[var(--ink)]">
                        {TONE_LABELS[opt.id]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--ink)]">When a human is needed</h3>
              <div className="mt-3 space-y-3">
                {HANDOFF_OPTIONS.map((opt) => {
                  const selected = handoffMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setHandoffMode(opt.id)}
                      className={[
                        "w-full text-left rounded-xl border px-4 py-4 transition duration-200",
                        selected
                          ? "border-[var(--accent)] bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]"
                          : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                      ].join(" ")}
                    >
                      <span className="font-medium text-[var(--ink)]">{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        {state.error ? (
          <p className="mt-5 text-sm text-[var(--warn)]" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              disabled={pending}
              className="text-sm text-[var(--ink-soft)] hover:text-[var(--ink)] disabled:opacity-50"
            >
              Back
            </button>
          ) : (
            <span />
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canAdvance()}
              onClick={() => goTo(step + 1)}
              className="rounded-xl bg-[var(--accent)] px-5 py-3 text-white font-medium hover:bg-[var(--accent-deep)] transition disabled:opacity-50"
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canAdvance() || pending}
              className="rounded-xl bg-[var(--accent)] px-5 py-3 text-white font-medium hover:bg-[var(--accent-deep)] transition disabled:opacity-50"
            >
              {pending ? "Opening your line…" : "Finish setup"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
