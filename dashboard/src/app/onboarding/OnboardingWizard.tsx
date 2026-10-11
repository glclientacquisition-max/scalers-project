"use client";

import { useActionState, useEffect, useState } from "react";
import {
  completeOnboardingAction,
  type OnboardingState,
} from "./actions";
import type { OnboardingTone } from "@/lib/onboarding";
import { DEFAULT_AGENT_TONE, TONE_LABELS, TONE_OPTIONS } from "@/lib/onboarding";
import {
  DEFAULT_VERTICAL,
  VERTICAL_OPTIONS,
  type BusinessVertical,
} from "@/lib/vertical";
import {
  HANDOFF_OPTIONS,
  liveConnectBlurb,
  type HandoffMode,
} from "@/lib/handoffMode";
import { compactTextareaExpandHandlers } from "@/components/settingsUi";
import { btnPrimary, deskFieldClass, deskShiftClass, focusRingVisible } from "@/components/ui/deskChrome";
import { Button, buttonClass } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { BaStakesPreview } from "@/components/BaStakesPreview";
import {
  OnboardingCapture,
  type ProductDraft,
  type ServiceDraft,
} from "@/components/OnboardingCapture";
import { SUGGESTED_FAQ_CHIPS } from "@/lib/catalogSeeds";
import { homeStakes, shopStakes } from "@/lib/baStakes";
import { homeCatalogPasses, hoursCapturePasses, shopCatalogGap, shopCatalogPasses } from "@/lib/outcomeGates";
import { ONBOARDING_DRAFT_KEY, parseOnboardingDraft, validateAgentName } from "@/lib/onboardingDraft";
import { parseVertical } from "@/lib/vertical";
import { parseHandoffMode } from "@/lib/handoffMode";

const STEPS = [
  "Business type",
  "Catalogue & pricing",
  "Hours & location",
  "Tone & handoff",
] as const;

function choiceClass(selected: boolean): string {
  return [
    `min-h-11 w-full rounded-xl border px-4 py-3 text-left ${deskShiftClass} ${focusRingVisible}`,
    selected
      ? "border-accent bg-accent-soft"
      : "border-line bg-surface hover:border-accent/50",
  ].join(" ");
}

const initial: OnboardingState = {};

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [vertical, setVertical] = useState<BusinessVertical | "">(DEFAULT_VERTICAL);
  const [products, setProducts] = useState<ProductDraft[]>([]);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [catalogSkipped, setCatalogSkipped] = useState(false);
  const [hoursSkipped, setHoursSkipped] = useState(false);
  const [faqAnswers, setFaqAnswers] = useState<Record<string, string>>({});
  const [hoursLocation, setHoursLocation] = useState("");
  const [landmark, setLandmark] = useState("");
  const [directions, setDirections] = useState("");
  const [tone, setTone] = useState<OnboardingTone | "">(DEFAULT_AGENT_TONE);
  const [handoffMode, setHandoffMode] = useState<HandoffMode>("callback");
  const [agentName, setAgentName] = useState("Receptionist");
  const [state, formAction, pending] = useActionState(completeOnboardingAction, initial);
  const [visible, setVisible] = useState(true);

  const [draftLoaded, setDraftLoaded] = useState(false);

  // Restore draft after refresh.
  useEffect(() => {
    const draft = parseOnboardingDraft(window.localStorage.getItem(ONBOARDING_DRAFT_KEY));
    if (draft) {
      if (draft.vertical) setVertical(parseVertical(draft.vertical));
      if (draft.products) setProducts(draft.products as ProductDraft[]);
      if (draft.services) setServices(draft.services as ServiceDraft[]);
      if (draft.faqAnswers) setFaqAnswers(draft.faqAnswers);
      if (draft.hoursLocation) setHoursLocation(draft.hoursLocation);
      if (draft.landmark) setLandmark(draft.landmark);
      if (draft.directions) setDirections(draft.directions);
      const t = TONE_OPTIONS.find((opt) => opt.id === draft.tone);
      if (t) setTone(t.id);
      if (draft.handoffMode) setHandoffMode(parseHandoffMode(draft.handoffMode));
      if (draft.agentName !== undefined) setAgentName(draft.agentName);
      if (draft.step) setStep(draft.step);
    }
    setDraftLoaded(true);
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    window.localStorage.setItem(
      ONBOARDING_DRAFT_KEY,
      JSON.stringify({ step, vertical, products, services, faqAnswers, hoursLocation, landmark, directions, tone, handoffMode, agentName })
    );
  }, [draftLoaded, step, vertical, products, services, faqAnswers, hoursLocation, landmark, directions, tone, handoffMode, agentName]);

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

  const shop = vertical !== "home_services";
  const gatedServices = services.map((row) => ({
    name: row.name,
    pricing_mode: row.pricing_mode,
    site_visit_required:
      row.site_visit === "yes" ? true : row.site_visit === "no" ? false : null,
  }));
  const catalogReady = shop
    ? shopCatalogPasses(products)
    : homeCatalogPasses(gatedServices);
  const hoursReady = hoursCapturePasses(hoursLocation);
  const confirmedFaqs = Object.entries(faqAnswers)
    .filter(([, answer]) => answer.trim())
    .map(([question, answer]) => ({
      question,
      answer: answer.trim(),
      source: "owner",
      status: "confirmed",
    }));
  const stakes =
    vertical === "home_services"
      ? homeStakes({ services: gatedServices, coverage: landmark })
      : shopStakes({ products, hoursText: hoursLocation, holdsAllowed: false });

  const agentNameCheck = validateAgentName(agentName);
  const catalogGap = shop && !catalogSkipped ? shopCatalogGap(products) : null;
  const hoursGap =
    step === 2 && !hoursSkipped && hoursLocation.trim() && !hoursReady
      ? "We couldn't read those hours. Use a form like \"Mon-Sat 9:00-18:00\". Closing must be after opening."
      : null;

  function canAdvance(): boolean {
    if (step === 0) return Boolean(vertical);
    if (step === 1) return catalogSkipped || catalogReady;
    if (step === 2) return hoursSkipped || hoursReady;
    if (step === 3) return Boolean(tone) && agentNameCheck.ok;
    return false;
  }

  return (
    <div className="mt-10">
      <ol className="mb-8 flex items-center gap-2" aria-label="Setup progress">
        {STEPS.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <span
                aria-hidden
                className={[
                  `pointer-events-none flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium ${deskShiftClass}`,
                  done || active
                    ? "bg-accent-fill text-accent-on-fill"
                    : "border border-line bg-surface text-ink-soft",
                ].join(" ")}
              >
                {i + 1}
              </span>
              <span
                className={[
                  `hidden text-sm sm:block ${deskShiftClass}`,
                  active ? "font-medium text-ink" : "text-ink-soft",
                ].join(" ")}
              >
                {label}
              </span>
              {i < STEPS.length - 1 ? (
                <span
                  className={[
                    `mx-1 h-px flex-1 ${deskShiftClass}`,
                    done ? "bg-accent" : "bg-line",
                  ].join(" ")}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <form
        action={formAction}
        onSubmit={() => window.localStorage.removeItem(ONBOARDING_DRAFT_KEY)}
        className={[
          `rounded-2xl border border-line bg-surface p-6 sm:p-8 ${deskShiftClass}`,
          visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        ].join(" ")}
      >
        <input type="hidden" name="vertical" value={vertical} />
        <input type="hidden" name="services_pricing" value="" />
        <input type="hidden" name="hours_location" value={hoursLocation} />
        <input type="hidden" name="catalog_skipped" value={catalogSkipped ? "1" : "0"} />
        <input type="hidden" name="hours_skipped" value={hoursSkipped ? "1" : "0"} />
        <input
          type="hidden"
          name="product_catalog"
          value={JSON.stringify(
            products.map((row) => ({ ...row, source: "owner" }))
          )}
        />
        <input
          type="hidden"
          name="services_catalog"
          value={JSON.stringify(
            gatedServices.map((row, index) => ({
              ...row,
              notes: services[index]?.notes || "",
              source: "owner",
            }))
          )}
        />
        <input type="hidden" name="faqs_json" value={JSON.stringify(confirmedFaqs)} />
        <input type="hidden" name="landmark" value={landmark} />
        <input type="hidden" name="directions" value={directions} />
        <input type="hidden" name="tone" value={tone} />
        <input type="hidden" name="handoff_mode" value={handoffMode} />
        <input type="hidden" name="agent_name" value={agentName} />

        {step === 0 ? (
          <div>
            <h2 className="font-display text-2xl text-ink">Business type</h2>
            <div className="mt-5 space-y-3">
              {VERTICAL_OPTIONS.map((opt) => {
                const selected = vertical === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setVertical(opt.id)}
                    className={choiceClass(selected)}
                  >
                    <span className="font-medium text-ink">{opt.label}</span>
                    <span className="mt-0.5 block text-sm text-ink-soft">
                      {opt.blurb}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div>
            <h2 className="font-display text-2xl text-ink">
              {vertical === "home_services" ? "Services & pricing" : "Products & pricing"}
            </h2>
            <OnboardingCapture
              vertical={vertical}
              products={products}
              services={services}
              onProducts={(rows) => {
                setCatalogSkipped(false);
                setProducts(rows);
              }}
              onServices={(rows) => {
                setCatalogSkipped(false);
                setServices(rows);
              }}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <h2 className="font-display text-2xl text-ink">Hours & location</h2>
            <div className="mt-5 flex flex-wrap gap-2">
              {["Mon-Sat 8-7", "Mon-Fri 9-5", "Mon-Sun 8-8"].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={buttonClass({
                    variant: hoursLocation === preset ? "tonal" : "ghost",
                    size: "sm",
                    className: "!rounded-md",
                  })}
                  onClick={() => {
                    setHoursSkipped(false);
                    setHoursLocation(preset);
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
            <Field id="hours_capture" label="Opening hours" className="mt-4">
              {(props) => (
                <Input
                  {...props}
                  value={hoursLocation}
                  onChange={(event) => {
                    setHoursSkipped(false);
                    setHoursLocation(event.target.value);
                  }}
                />
              )}
            </Field>
            <label className="mt-4 block text-sm font-medium text-ink" htmlFor="landmark">
              Landmark (optional)
            </label>
            <input
              id="landmark"
              value={landmark}
              onChange={(e) => setLandmark(e.target.value)}
              placeholder="Opposite Naivas, next to the Shell"
              className={`mt-2 ${deskFieldClass}`}
            />
            <label
              className="mt-4 block text-sm font-medium text-ink"
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
              className={`mt-2 leading-relaxed ${deskFieldClass}`}
            />
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-8">
            <div>
              <h2 className="font-display text-2xl text-ink">Receptionist name & tone</h2>
              <label
                className="mt-5 block text-sm font-medium text-ink"
                htmlFor="agent_name_field"
              >
                Receptionist name
              </label>
              <input
                id="agent_name_field"
                required
                maxLength={40}
                aria-invalid={!agentNameCheck.ok}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="Receptionist"
                className={`mt-2 ${deskFieldClass}`}
              />
              <div className="mt-5 space-y-3">
                {TONE_OPTIONS.map((opt) => {
                  const selected = tone === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setTone(opt.id)}
                      className={choiceClass(selected)}
                    >
                      <span className="font-medium text-ink">{TONE_LABELS[opt.id]}</span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {opt.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium text-ink">When a caller needs a human</h3>
              <div className="mt-3 space-y-3">
                {HANDOFF_OPTIONS.map((opt) => {
                  const selected = handoffMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setHandoffMode(opt.id)}
                      className={choiceClass(selected)}
                    >
                      <span className="font-medium text-ink">{opt.label}</span>
                      {opt.id === "live_transfer" ? (
                        <span className="mt-0.5 block text-sm text-ink-soft">
                          {liveConnectBlurb()}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mt-8">
              <h3 className="text-sm font-medium text-ink">Answers you can confirm</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUGGESTED_FAQ_CHIPS.map((question) => {
                  return (
                    <button
                      key={question}
                      type="button"
                      className={buttonClass({
                        variant: faqAnswers[question]?.trim() ? "tonal" : "ghost",
                        size: "sm",
                        className: "!rounded-md",
                      })}
                      onClick={() => {
                        setFaqAnswers((prev) => {
                          if (Object.prototype.hasOwnProperty.call(prev, question)) {
                            const next = { ...prev };
                            delete next[question];
                            return next;
                          }
                          return { ...prev, [question]: "" };
                        });
                      }}
                    >
                      {question}
                    </button>
                  );
                })}
              </div>
              {SUGGESTED_FAQ_CHIPS.filter((question) =>
                Object.prototype.hasOwnProperty.call(faqAnswers, question)
              ).map((question, index) => (
                <Field key={question} id={`faq-answer-${index}`} label={question} className="mt-3">
                  {(props) => (
                    <Input
                      {...props}
                      value={faqAnswers[question] || ""}
                      onChange={(event) =>
                        setFaqAnswers((prev) => ({ ...prev, [question]: event.target.value }))
                      }
                    />
                  )}
                </Field>
              ))}
            </div>
            <BaStakesPreview title="What your BA will say" lines={stakes} />
          </div>
        ) : null}

        {step === 1 && catalogGap ? (
          <p className="mt-5 text-sm text-ink-soft" role="status">{catalogGap}</p>
        ) : null}
        {hoursGap ? (
          <p className="mt-5 text-sm text-warn" role="status">{hoursGap}</p>
        ) : null}
        {step === 3 && !agentNameCheck.ok ? (
          <p className="mt-5 text-sm text-warn" role="status">{agentNameCheck.error}</p>
        ) : null}
        {state.error ? (
          <p className="mt-5 text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}

        <div className="mt-8 flex items-center justify-between gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => {
                if (step - 1 === 1) setCatalogSkipped(false);
                if (step - 1 === 2) setHoursSkipped(false);
                goTo(step - 1);
              }}
              disabled={pending}
              className={`min-h-11 text-sm text-ink-soft ${deskShiftClass} ${focusRingVisible} hover:text-ink disabled:opacity-50`}
            >
              Back
            </button>
          ) : (
            <span />
          )}

          {step === 1 || step === 2 ? (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                if (step === 1) setCatalogSkipped(true);
                if (step === 2) setHoursSkipped(true);
                goTo(step + 1);
              }}
            >
              Skip
            </Button>
          ) : null}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canAdvance()}
              onClick={() => goTo(step + 1)}
              className={btnPrimary}
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canAdvance() || pending}
              className={btnPrimary}
            >
              {pending ? "Opening your line" : "Finish setup"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
