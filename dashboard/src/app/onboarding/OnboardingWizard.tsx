"use client";

import { useActionState, useEffect, useState } from "react";
import {
  completeOnboardingAction,
  type OnboardingState,
} from "./actions";
import type { OnboardingTone } from "@/lib/onboarding";
import { TONE_LABELS } from "@/lib/onboarding";

const STEPS = ["Services & pricing", "Hours & location", "Tone of voice"] as const;

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

export function OnboardingWizard({ businessName }: { businessName: string }) {
  const [step, setStep] = useState(0);
  const [servicesPricing, setServicesPricing] = useState("");
  const [hoursLocation, setHoursLocation] = useState("");
  const [tone, setTone] = useState<OnboardingTone | "">("");
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
    if (step === 0) return servicesPricing.trim().length >= 12;
    if (step === 1) return hoursLocation.trim().length >= 8;
    if (step === 2) return Boolean(tone);
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
        <input type="hidden" name="services_pricing" value={servicesPricing} />
        <input type="hidden" name="hours_location" value={hoursLocation} />
        <input type="hidden" name="tone" value={tone} />

        {step === 0 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Services & pricing</h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
              What does {businessName} offer, and how should the receptionist talk about price?
            </p>
            <textarea
              autoFocus
              value={servicesPricing}
              onChange={(e) => setServicesPricing(e.target.value)}
              rows={8}
              placeholder={
                "e.g. Plumbing repairs, electrical fixes, and deep cleaning across Nairobi.\nPricing: we quote after understanding the job. Call-out from KES 1,500. M-Pesa and cash."
              }
              className="mt-5 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)] leading-relaxed"
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Hours & location</h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
              When are you open, and which areas do you cover?
            </p>
            <textarea
              autoFocus
              value={hoursLocation}
              onChange={(e) => setHoursLocation(e.target.value)}
              rows={7}
              placeholder={
                "e.g. Mon–Sat 8:00am–6:00pm EAT. Closed Sundays.\nService area: Nairobi, Kiambu, Ruiru. Note after-hours for callback."
              }
              className="mt-5 w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[var(--ink)] outline-none focus:border-[var(--accent)] leading-relaxed"
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="font-display text-2xl text-[var(--ink)]">Tone of voice</h2>
            <p className="mt-2 text-sm text-[var(--ink-soft)] leading-relaxed">
              How should callers feel when they reach your AI receptionist?
            </p>
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
                        ? "border-[var(--accent)] bg-[#e8f4f1] shadow-[inset_0_0_0_1px_var(--accent)]"
                        : "border-[var(--line)] bg-white hover:border-[var(--accent)]/50",
                    ].join(" ")}
                  >
                    <span className="font-medium text-[var(--ink)]">{TONE_LABELS[opt.id]}</span>
                    <span className="mt-1 block text-sm text-[var(--ink-soft)]">{opt.blurb}</span>
                  </button>
                );
              })}
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
              {pending ? "Building your receptionist…" : "Finish setup"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
