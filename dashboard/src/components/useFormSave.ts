"use client";

import {
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { notify } from "@/components/ui/DeskNotice";
import { useSettingsLeaveSource } from "@/components/SettingsLeaveGuard";
import {
  FORM_SAVE_DEFAULT_SUCCESS,
  draftSignature,
  formSaveUnloadHandler,
  nextBaseline,
  saveOutcome,
  shouldGuardUnload,
  thrownSaveResult,
  type FormSaveResult,
} from "@/lib/formSave";

/**
 * The one save pattern for Desk Settings, setup and onboarding forms.
 *
 *   const save = useFormSave({ action, initialState, successMessage, formId });
 *   const { dirty } = useFormDraft(save, { id: "alerts", values: draft });
 *
 * useFormSave owns the save: pending, success toast, inline "Saved", inline and
 * toast errors, retry, and dropped connections. useFormDraft owns the draft:
 * normalised dirty tracking (NULL, undefined and "" are equal), the baseline
 * moved to exactly what was submitted when a save lands, and the leave and
 * reload guard. useFormSaveDraft is both in one call for simple forms.
 */

/** How long the Save button reads "Saved" after a landed save. */
export const FORM_SAVED_HOLD_MS = 2400;

type SaveOptions<R extends FormSaveResult, P> = {
  action: (prev: R, payload: P) => Promise<R>;
  initialState: R;
  /** Toast copy after a landed save. false: no toast (the save navigates away). */
  successMessage?: string | false;
  /** Toast failed saves as well as showing them inline. Default true. */
  errorToast?: boolean;
  /** Form element id, so retry() resubmits what is on screen now. */
  formId?: string;
  onSaved?: (result: R) => void;
  onFailed?: (result: R) => void;
};

export type FormSave<R extends FormSaveResult, P = FormData> = {
  state: R;
  initialState: R;
  formAction: (payload: P) => void;
  submit: (payload: P) => void;
  retry: () => void;
  pending: boolean;
  error: string | null;
  /** True for FORM_SAVED_HOLD_MS after a landed save. */
  justSaved: boolean;
  /** @internal Draft signature at submit time, written by useFormDraft. */
  signatureRef: { current: string | null };
  /** @internal Submitted signature per result. */
  submittedFor: WeakMap<object, string>;
};

export function useFormSave<R extends FormSaveResult, P = FormData>(
  options: SaveOptions<R, P>
): FormSave<R, P> {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const [submittedFor] = useState(() => new WeakMap<object, string>());
  const lastPayload = useRef<P | null>(null);
  const signatureRef = useRef<string | null>(null);

  const run = useCallback(
    async (prev: R, payload: P): Promise<R> => {
      const opts = optionsRef.current;
      lastPayload.current = payload;
      const submitted = signatureRef.current;
      let result: R;
      try {
        result = await opts.action(prev, payload);
      } catch (err) {
        result = thrownSaveResult<R>(err);
      }
      if (!result || typeof result !== "object") result = {} as R;
      const outcome = saveOutcome(
        result,
        typeof opts.successMessage === "string" ? opts.successMessage : FORM_SAVE_DEFAULT_SUCCESS
      );
      // Toast here, not from component state: a save can remount the form.
      if (outcome.kind === "ok") {
        if (result.error) notify(result.error);
        else if (opts.successMessage !== false) notify(outcome.message);
      } else if (opts.errorToast !== false) {
        notify(outcome.message);
      }
      if (submitted !== null) submittedFor.set(result, submitted);
      return result;
    },
    [submittedFor]
  );

  const [rawState, dispatch, pending] = useActionState<R, P>(
    run as (prev: Awaited<R>, payload: P) => Promise<R>,
    options.initialState as Awaited<R>
  );
  const state = rawState as R;

  const [handled, setHandled] = useState(state);
  const [savedAt, setSavedAt] = useState(0);
  if (handled !== state) {
    setHandled(state);
    if (state.ok) setSavedAt(Date.now());
  }
  const [clearedAt, setClearedAt] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const timer = window.setTimeout(() => setClearedAt(savedAt), FORM_SAVED_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [savedAt]);
  const justSaved = savedAt > 0 && clearedAt !== savedAt && !pending;

  // Callbacks after commit, once per result.
  const reported = useRef(state);
  useEffect(() => {
    if (reported.current === state) return;
    reported.current = state;
    if (state.ok) optionsRef.current.onSaved?.(state);
    else if (state.error || state.networkError) optionsRef.current.onFailed?.(state);
  }, [state]);

  /** Save a payload outside a form action (buttons, step flows). */
  const submit = useCallback((payload: P) => {
    startTransition(() => dispatch(payload));
  }, [dispatch]);

  const retry = useCallback(() => {
    const formId = optionsRef.current.formId;
    const form = formId ? document.getElementById(formId) : null;
    if (form instanceof HTMLFormElement) {
      form.requestSubmit();
      return;
    }
    if (lastPayload.current !== null) submit(lastPayload.current);
  }, [submit]);

  const outcome = state === options.initialState ? null : saveOutcome(state);
  const error =
    outcome?.kind === "error" ? outcome.message : state.ok && state.error ? state.error : null;

  return {
    state,
    initialState: options.initialState,
    formAction: dispatch,
    submit,
    retry,
    pending,
    error,
    justSaved,
    signatureRef,
    submittedFor,
  };
}

type DraftOptions = {
  /** Leave-guard source id (one per form on the page). */
  id: string;
  /** The draft as the owner sees it. Compared after normalisation. */
  values: unknown;
  /** Turn the guard off (for example while a finish redirect runs). */
  guardDisabled?: boolean;
  /**
   * The form rewrites its draft from the save result in render (server
   * normalised values). The baseline then moves to the draft as rendered with
   * the result, not to the submitted one. Default false.
   */
  adoptsResult?: boolean;
};

/**
 * Dirty tracking with a normalised baseline plus the leave and reload guard.
 * Pass `save` to move the baseline when its saves land; pass null for flows
 * with their own save choreography and call markClean() yourself.
 */
export function useFormDraft<R extends FormSaveResult, P>(
  save: FormSave<R, P> | null,
  { id, values, guardDisabled = false, adoptsResult = false }: DraftOptions
) {
  const signature = draftSignature(values);
  const [baseline, setBaseline] = useState(signature);
  if (save) save.signatureRef.current = signature;

  // Move the baseline in render (not in an effect) so the first frame after a
  // landed save is already clean and the reload guard never arms.
  const saveState = save ? save.state : null;
  const [seen, setSeen] = useState(saveState);
  if (save && seen !== saveState) {
    setSeen(saveState);
    if (saveState && saveState !== save.initialState) {
      const submitted = adoptsResult
        ? signature
        : (save.submittedFor.get(saveState as object) ?? signature);
      setBaseline((prev) => nextBaseline(saveState, submitted, prev));
    }
  }

  const dirty = signature !== baseline;
  const pending = Boolean(save?.pending);
  const guarded = shouldGuardUnload({ dirty, pending, disabled: guardDisabled });
  const guardRef = useRef(guarded);
  useEffect(() => {
    guardRef.current = guarded;
  });

  // Link clicks and Back inside Settings ask through SettingsLeaveGuard.
  useSettingsLeaveSource(id, !guardDisabled && dirty);

  // Reload and tab close ask here, so forms outside SettingsLeaveGuard are covered too.
  useEffect(() => {
    if (!guarded) return;
    const onBeforeUnload = formSaveUnloadHandler(() => guardRef.current);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [guarded]);

  /** Treat these values (default: the current draft) as saved. */
  const markClean = useCallback(
    (saved?: unknown) => setBaseline(saved === undefined ? signature : draftSignature(saved)),
    [signature]
  );

  return { dirty, markClean, justSaved: Boolean(save?.justSaved) && !dirty };
}

/** useFormSave + useFormDraft for forms whose draft is known up front. */
export function useFormSaveDraft<R extends FormSaveResult, P = FormData>(
  options: SaveOptions<R, P> & DraftOptions
) {
  const save = useFormSave<R, P>(options);
  const draft = useFormDraft(save, options);
  return { ...save, ...draft };
}
