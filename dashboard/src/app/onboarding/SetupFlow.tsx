"use client";
import { AppearanceFooter } from "@/components/ThemePicker";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { CheckCircleIcon, ChevronLeftIcon } from "@heroicons/react/20/solid";
import { Button } from "@/components/ui/Button";
import { pendingSpinnerClass } from "@/components/ui/deskChrome";
import {
  DEFAULT_AGENT_NAME,
  draftStorageKey,
  readLocalDraft,
  parseDraft,
  resumeStep,
  SETUP_STEPS,
  stepIndex,
  validateStep,
  type FieldErrors,
  type SetupDraft,
  type StepKey,
} from "@/lib/setupFlow";
import { finishSetupAction, saveSetupStepAction } from "./setupActions";
import { useFormDraft } from "@/components/useFormSave";
import { isNavigationError } from "@/lib/formSave";
import { BusinessStep } from "./steps/BusinessStep";
import { CatalogueStep } from "./steps/CatalogueStep";
import { HoursStep } from "./steps/HoursStep";
import { VoiceStep } from "./steps/VoiceStep";
import { FaqsStep } from "./steps/FaqsStep";
import { AlertsStep } from "./steps/AlertsStep";


const LEADS: Record<StepKey, (business: string) => string> = {
  business: (b) => `Tell your Business Assistant what ${b} does and where callers can find you.`,
  catalogue: () => "Your Business Assistant quotes these prices to callers.",
  hours: () => "Callers hear these when they ask if you're open.",
  voice: () => "Choose how your Business Assistant sounds and what happens when a caller needs you.",
  faqs: () => "Answer the questions you get every day, so callers don't have to wait for you.",
  alerts: () => "Where we reach you when a caller needs you.",
};

/** Shown only when the request never reached us (thrown fetch), not for server errors. */
function unreachableMessage(verb: string): string {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return `You're offline. Your answers are kept on this device. Reconnect, then ${verb} again.`;
  }
  return `Couldn't reach Scalers to ${verb}. Your answers are kept on this device. Try again.`;
}

export function SetupFlow({
  tenantId,
  userId,
  businessName,
  initialDraft,
  initialVersion,
  furthestStep,
  requestedStep,
  signOut,
}: {
  tenantId: string;
  userId: string;
  businessName: string;
  initialDraft: SetupDraft;
  initialVersion: number;
  furthestStep: number;
  requestedStep: string | null;
  signOut: ReactNode;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [version, setVersion] = useState(initialVersion);
  const [furthest, setFurthest] = useState(Math.min(furthestStep, SETUP_STEPS.length - 1));
  const [index, setIndex] = useState(() => resumeStep(requestedStep, furthestStep));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ tone: "warn" | "info"; text: string } | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [pending, startTransition] = useTransition();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const step = SETUP_STEPS[index];
  const key = step.key;
  const isLast = index === SETUP_STEPS.length - 1;
  const busy = pending || finishing;

  // Steps live in the URL, so browser Back/Forward move between steps and refresh keeps your place.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("step") !== key) {
      url.searchParams.set("step", key);
      window.history.replaceState(window.history.state, "", url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPop = () => {
      const want = stepIndex(new URL(window.location.href).searchParams.get("step"));
      if (want >= 0 && want <= furthest) {
        setIndex((current) => {
          pushed.current = want < current ? Math.max(0, pushed.current - 1) : pushed.current + 1;
          return want;
        });
        setErrors({});
        setMessage(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [furthest]);

  // Move focus to the new step's title so screen readers announce it; scroll to top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // Route-like change: instant, no smooth scroll (desk motion: route has no motion).
    window.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Shared save pattern (useFormDraft): dirty is the draft against what the server
  // last stored, compared normalised, so typing and then undoing it is clean. It
  // also owns the reload guard, off while finishing redirects to the line screen.
  const { dirty, markClean } = useFormDraft(null, { id: "setup", values: draft, guardDisabled: finishing });

  // Unsaved typing survives reloads: kept per account + workspace on this device, and only
  // restored on top of the same server version it was typed against (another device's save wins).
  const storageKey = draftStorageKey(tenantId, userId);
  const restored = useRef(false);
  useEffect(() => {
    const local = readLocalDraft(window.localStorage.getItem(storageKey), initialVersion);
    if (local) {
      // Restored typing stays dirty: the baseline is still the server draft.
      setDraft(parseDraft(local, {}));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restored.current) return;
    if (!dirty) {
      // Back to what the server has: nothing to keep on this device.
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ base: version, draft }));
    } catch {
      /* storage full or blocked: the server draft still has every saved step */
    }
  }, [draft, version, storageKey, dirty]);
  const clearLocal = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const pushed = useRef(0);
  const goTo = useCallback((next: number) => {
    setErrors({});
    setIndex(next);
    pushed.current += 1;
    const url = new URL(window.location.href);
    url.searchParams.set("step", SETUP_STEPS[next].key);
    window.history.pushState(window.history.state, "", url);
  }, []);

  function focusFirstError(fields: FieldErrors) {
    const first = Object.keys(fields)[0];
    if (!first) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(first)}"]`);
      if (!el) return;
      const target = el.matches("input,textarea,select,button") ? el : el.querySelector<HTMLElement>("input,textarea,select,button") || el;
      target.focus();
      target.scrollIntoView({ block: "center" });
    });
  }

  function patch<K extends StepKey>(k: K, value: SetupDraft[K]) {
    setDraft((d) => ({ ...d, [k]: value }));
    if (Object.keys(errors).length) setErrors({});
  }

  function save(value: unknown, after: () => void) {
    setMessage(null);
    // Same rules as the server, so mistakes show instantly. The server checks again.
    const local = validateStep(key, value, draft);
    if (!local.ok) {
      setErrors(local.fields);
      setMessage({ tone: "warn", text: local.error });
      focusFirstError(local.fields);
      return;
    }
    startTransition(async () => {
      try {
        const res = await saveSetupStepAction({ tenantId, key, value: local.value, version, vertical: draft.business.vertical });
        if (res.ok) {
          clearLocal();
          const saved = { ...draft, [key]: local.value as SetupDraft[typeof key] };
          setDraft(saved);
          markClean(saved);
          setVersion(res.version);
          setFurthest((f) => Math.max(f, res.furthest));
          after();
          return;
        }
        if (res.conflict) {
          clearLocal();
          setDraft(res.draft);
          markClean(res.draft);
          setVersion(res.version);
          setFurthest(Math.min(res.furthest, SETUP_STEPS.length - 1));
          setMessage({ tone: "info", text: res.error });
          return;
        }
        setErrors(res.fields || {});
        setMessage({ tone: "warn", text: res.error });
        focusFirstError(res.fields || {});
      } catch {
        setMessage({ tone: "warn", text: unreachableMessage("save") });
      }
    });
  }

  async function runFinish(nextVersion: number) {
    const res = await finishSetupAction({ tenantId, version: nextVersion });
    // Success redirects to the line screen; we only get here with a problem.
    if (res.conflict) {
      window.location.reload();
      return;
    }
    setFinishing(false);
    setMessage({ tone: "warn", text: res.error });
    if (res.step) goTo(stepIndex(res.step));
  }

  function onContinue() {
    const value = draft[key];
    if (!isLast) {
      save(value, () => goTo(index + 1));
      return;
    }
    // Last step: save alerts, then finish with the version that save returned.
    const local = validateStep(key, value, draft);
    if (!local.ok) {
      setErrors(local.fields);
      setMessage({ tone: "warn", text: local.error });
      focusFirstError(local.fields);
      return;
    }
    setMessage(null);
    setFinishing(true);
    startTransition(async () => {
      try {
        const res = await saveSetupStepAction({ tenantId, key, value: local.value, version, vertical: draft.business.vertical });
        if (!res.ok) {
          setFinishing(false);
          if (res.conflict) {
            setDraft(res.draft);
            setVersion(res.version);
            setMessage({ tone: "info", text: res.error });
          } else {
            setErrors(res.fields || {});
            setMessage({ tone: "warn", text: res.error });
            focusFirstError(res.fields || {});
          }
          return;
        }
        markClean();
        clearLocal();
        setVersion(res.version);
        await runFinish(res.version);
      } catch (err) {
        if (isNavigationError(err)) throw err;
        setFinishing(false);
        setMessage({ tone: "warn", text: unreachableMessage("finish setup") });
      }
    });
  }

  function onSkip() {
    // Skipping keeps what you typed (so Back brings it back) but setup ignores it.
    // Receptionist has no "skipped" state: skipping keeps the ready-made defaults.
    const value =
      key === "voice"
        ? { ...draft.voice, agentName: draft.voice.agentName.trim() || DEFAULT_AGENT_NAME }
        : { ...(draft[key] as object), skipped: true };
    save(value, () => goTo(index + 1));
  }

  function onBack() {
    if (index === 0) return;
    setMessage(null);
    if (pushed.current > 0) {
      pushed.current -= 1;
      window.history.back();
      return;
    }
    // Opened mid-flow from a link: step back without leaving the page.
    setErrors({});
    setIndex(index - 1);
    const url = new URL(window.location.href);
    url.searchParams.set("step", SETUP_STEPS[index - 1].key);
    window.history.replaceState(window.history.state, "", url);
  }

  // The header and the docked Continue bar are fixed. Scroll padding keeps a focused field,
  // price segment or Remove link clear of both when the browser scrolls it into view.
  useEffect(() => {
    const root = document.documentElement;
    const prevTop = root.style.scrollPaddingTop;
    const prevBottom = root.style.scrollPaddingBottom;
    root.style.scrollPaddingTop = "calc(4.5rem + env(safe-area-inset-top))";
    root.style.scrollPaddingBottom = "calc(6.5rem + env(safe-area-inset-bottom))";
    return () => {
      root.style.scrollPaddingTop = prevTop;
      root.style.scrollPaddingBottom = prevBottom;
    };
  }, []);

  if (finishing) return <FinishingScreen />;

  return (
    <main data-setup-flow="" className="min-h-dvh pb-[calc(10rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-1">
            {/* Back keeps its slot on step 1 (invisible) so the logo never shifts. */}
            {(
              <button
                aria-hidden={index === 0 || undefined}
                tabIndex={index === 0 ? -1 : undefined}
                type="button"
                onClick={onBack}
                disabled={busy || index === 0}
                className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-body text-accent-deep disabled:opacity-50 ${index === 0 ? "invisible" : ""} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand`}
              >
                <ChevronLeftIcon aria-hidden className="h-5 w-5" />
                Back
              </button>
            )}
            <BrandWordmark href="/onboarding" context="Setup" variant="lockup" priority />
          </div>
          <p className="ml-auto text-meta tabular-nums text-ink-2" aria-hidden>
            {index + 1} of {SETUP_STEPS.length}
          </p>
          {signOut}
        </div>
        <div
          className="h-0.5 bg-hairline"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={1}
          aria-valuemax={SETUP_STEPS.length}
          aria-valuenow={index + 1}
          aria-valuetext={`Step ${index + 1} of ${SETUP_STEPS.length}: ${step.title}`}
        >
          <div className="h-full bg-accent" style={{ width: `${((index + 1) / SETUP_STEPS.length) * 100}%` }} />
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <h1 ref={headingRef} tabIndex={-1} className="text-display text-ink outline-none">
          {step.title}
        </h1>
        <p className="mt-2 text-body text-ink-2">{LEADS[key](businessName)}</p>

        {message ? (
          <p
            role={message.tone === "warn" ? "alert" : "status"}
            className={`mt-4 rounded-xl px-4 py-3 text-meta ${message.tone === "warn" ? "bg-attention-tonal text-attention" : "bg-accent-soft text-ink"}`}
          >
            {message.text}
          </p>
        ) : null}

        {key === "business" ? <BusinessStep value={draft.business} onChange={(v) => patch("business", v)} errors={errors} /> : null}
        {key === "catalogue" ? (
          <CatalogueStep value={draft.catalogue} onChange={(v) => patch("catalogue", v)} errors={errors} vertical={draft.business.vertical} />
        ) : null}
        {key === "hours" ? <HoursStep value={draft.hours} onChange={(v) => patch("hours", v)} errors={errors} /> : null}
        {key === "voice" ? <VoiceStep value={draft.voice} onChange={(v) => patch("voice", v)} errors={errors} businessName={businessName} /> : null}
        {key === "faqs" ? <FaqsStep value={draft.faqs} onChange={(v) => patch("faqs", v)} errors={errors} vertical={draft.business.vertical} /> : null}
        {key === "alerts" ? <AlertsStep value={draft.alerts} onChange={(v) => patch("alerts", v)} errors={errors} /> : null}
        <div className="mt-10 flex justify-center">
          <AppearanceFooter />
        </div>
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-canvas/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4">
          {step.skippable ? (
            <Button variant="ghost" onClick={onSkip} disabled={busy} className="text-ink-2">
              Skip for now
            </Button>
          ) : null}
          <Button variant="primary" onClick={onContinue} pending={busy} className="ml-auto min-w-36">
            {isLast ? (busy ? "Finishing…" : "Finish setup") : busy ? "Saving…" : "Continue"}
          </Button>
        </div>
      </footer>
    </main>
  );
}

const FINISH_STAGES = ["Saving your answers", "Writing your Business Assistant's script", "Getting your phone number"] as const;

/** Step-by-step progress while Finish runs. Stages advance on a timer; the last waits for the redirect. */
export function FinishingScreen() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setStage((s) => Math.min(s + 1, FINISH_STAGES.length - 1)), 900);
    return () => window.clearInterval(id);
  }, []);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-xs">
        <h1 className="text-title text-ink">Setting up your Business Assistant</h1>
        <ol className="mt-4 space-y-3" aria-label="Setup progress">
          {FINISH_STAGES.map((label, i) => {
            const state = i < stage ? "done" : i === stage ? "current" : "todo";
            return (
              <li key={label} className="flex items-center gap-3 text-body" aria-current={state === "current" ? "step" : undefined}>
                {state === "done" ? (
                  <CheckCircleIcon aria-hidden className="h-5 w-5 text-accent" />
                ) : state === "current" ? (
                  <span aria-hidden className={`${pendingSpinnerClass} block h-5 w-5`} />
                ) : (
                  <span aria-hidden className="block h-5 w-5 rounded-full border-2 border-hairline" />
                )}
                <span className={state === "todo" ? "text-ink-3" : "text-ink"}>
                  {label}
                  <span className="sr-only">{state === "done" ? ", done" : state === "current" ? ", in progress" : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p role="status" aria-live="polite" className="sr-only">
          {FINISH_STAGES[stage]}
        </p>
      </div>
    </main>
  );
}
