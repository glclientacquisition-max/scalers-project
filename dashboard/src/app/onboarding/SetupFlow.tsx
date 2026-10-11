"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { BrandWordmark } from "@/components/brand/BrandMark";
import { btnPrimary, pendingSpinnerClass } from "@/components/ui/deskChrome";
import {
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
import { BusinessStep } from "./steps/BusinessStep";
import { CatalogueStep } from "./steps/CatalogueStep";
import { HoursStep } from "./steps/HoursStep";
import { VoiceStep } from "./steps/VoiceStep";
import { FaqsStep } from "./steps/FaqsStep";
import { AlertsStep } from "./steps/AlertsStep";

function isRedirect(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "digest" in err && String((err as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT"));
}

const LEADS: Record<StepKey, (business: string) => string> = {
  business: (b) => `Tell your receptionist what ${b} does and where callers can find you.`,
  catalogue: () => "Your receptionist quotes these prices to callers.",
  hours: () => "Callers hear these when they ask if you're open.",
  voice: () => "Choose how your receptionist sounds and what happens when a caller needs you.",
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Warn before leaving with an unsaved edit on this step.
  const dirty = useRef(false);

  // Unsaved typing survives reloads: kept per account + workspace on this device, and only
  // restored on top of the same server version it was typed against (another device's save wins).
  const storageKey = draftStorageKey(tenantId, userId);
  const restored = useRef(false);
  useEffect(() => {
    const local = readLocalDraft(window.localStorage.getItem(storageKey), initialVersion);
    if (local) {
      dirty.current = true;
      setDraft(parseDraft(local, {}));
    } else {
      window.localStorage.removeItem(storageKey);
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!restored.current || !dirty.current) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ base: version, draft }));
    } catch {
      /* storage full or blocked: the server draft still has every saved step */
    }
  }, [draft, version, storageKey]);
  const clearLocal = () => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current && !finishing) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [finishing]);

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
    dirty.current = true;
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
          dirty.current = false;
          clearLocal();
          setDraft((d) => ({ ...d, [key]: local.value as SetupDraft[typeof key] }));
          setVersion(res.version);
          setFurthest((f) => Math.max(f, res.furthest));
          after();
          return;
        }
        if (res.conflict) {
          dirty.current = false;
          clearLocal();
          setDraft(res.draft);
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
        dirty.current = false;
        clearLocal();
        setVersion(res.version);
        await runFinish(res.version);
      } catch (err) {
        if (isRedirect(err)) throw err;
        setFinishing(false);
        setMessage({ tone: "warn", text: unreachableMessage("finish setup") });
      }
    });
  }

  function onSkip() {
    // Skipping keeps what you typed (so Back brings it back) but setup ignores it.
    const value = { ...(draft[key] as object), skipped: true };
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

  if (finishing) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div role="status" aria-live="polite" className="text-center">
          <span aria-hidden className={`${pendingSpinnerClass} mx-auto block h-6 w-6`} />
          <p className="mt-4 text-title text-ink">Setting up your receptionist</p>
          <p className="mt-1 text-meta text-ink-2">This takes a few seconds.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh pb-[calc(10rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-10 border-b border-hairline bg-canvas/90 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-2 px-3">
          <div className="flex min-w-0 items-center gap-1">
            {index > 0 ? (
              <button
                type="button"
                onClick={onBack}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-body text-accent-deep disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5">
                  <path fill="currentColor" d="M12.7 4.3 7 10l5.7 5.7-1.1 1.1L4.8 10l6.8-6.8z" />
                </svg>
                Back
              </button>
            ) : null}
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
          <div className="h-full bg-accent motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${((index + 1) / SETUP_STEPS.length) * 100}%` }} />
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
      </div>

      <footer className="fixed inset-x-0 bottom-0 z-10 border-t border-hairline bg-canvas/90 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur supports-[backdrop-filter]:bg-canvas/75">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4">
          {step.skippable ? (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="min-h-11 rounded-xl px-4 text-body font-medium text-ink-2 hover:bg-surface disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Skip for now
            </button>
          ) : null}
          <button type="button" onClick={onContinue} disabled={busy} aria-busy={busy || undefined} className={`${btnPrimary} ml-auto min-w-36 gap-2 text-body`}>
            {busy ? <span aria-hidden className={pendingSpinnerClass} /> : null}
            {isLast ? (busy ? "Finishing…" : "Finish setup") : busy ? "Saving…" : "Continue"}
          </button>
        </div>
      </footer>
    </main>
  );
}
