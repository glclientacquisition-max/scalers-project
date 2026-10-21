/**
 * Shared save contract for Desk Settings, setup and onboarding forms.
 * Pure helpers here; the React side is useFormSave in components/useFormSave.ts.
 *
 * Dirty state compares a normalised signature of the draft, never raw values:
 * NULL, undefined and "" are the same empty value, CRLF is LF, strings are
 * trimmed, object keys are sorted and empty keys drop out. A form that loads a
 * NULL column into a "" input, or a picker that stays unset, is therefore clean.
 */

export type FormSaveResult = {
  ok?: boolean;
  error?: string | null;
  /** Optional success copy from the server ("Saved", "Alerts updated"). */
  message?: string | null;
  networkError?: boolean;
};

export const FORM_SAVE_NETWORK_ERROR =
  "Could not reach Scalers. Your changes are still here. Try again.";
export const FORM_SAVE_GENERIC_ERROR = "Could not save. Try again.";
export const FORM_SAVE_DEFAULT_SUCCESS = "Saved";

/** Normalised copy of a draft value for dirty comparison. */
export function normalizeDraftValue(value: unknown): unknown {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n").trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeDraftValue);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const next = normalizeDraftValue((value as Record<string, unknown>)[key]);
      if (next === "") continue;
      out[key] = next;
    }
    return out;
  }
  return String(value);
}

/** Stable string for a draft. Equal signatures mean nothing to save. */
export function draftSignature(value: unknown): string {
  return JSON.stringify(normalizeDraftValue(value));
}

export function draftsEqual(a: unknown, b: unknown): boolean {
  return draftSignature(a) === draftSignature(b);
}

export type SaveOutcome =
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string; network: boolean };

/**
 * How a result reads to the owner. `ok` with an `error` is a partial save
 * (for example a price that could not be read): the save landed, so the
 * baseline moves, but the note is shown as an error.
 */
export function saveOutcome(
  result: FormSaveResult | null | undefined,
  successMessage: string = FORM_SAVE_DEFAULT_SUCCESS
): SaveOutcome {
  if (!result) return { kind: "error", message: FORM_SAVE_GENERIC_ERROR, network: false };
  if (result.networkError) {
    return { kind: "error", message: result.error || FORM_SAVE_NETWORK_ERROR, network: true };
  }
  if (result.ok) {
    return { kind: "ok", message: result.message?.trim() || successMessage };
  }
  return { kind: "error", message: result.error?.trim() || FORM_SAVE_GENERIC_ERROR, network: false };
}

/** True when the save landed, even if it carries a partial-save note. */
export function saveLanded(result: FormSaveResult | null | undefined): boolean {
  return Boolean(result?.ok);
}

/**
 * Baseline after a result. A landed save moves the baseline to the draft that
 * was submitted (not to whatever the owner typed while it was in flight), so
 * edits made during the save stay dirty. A failed save keeps the old baseline.
 */
export function nextBaseline(
  result: FormSaveResult | null | undefined,
  submittedSignature: string,
  baselineSignature: string
): string {
  return saveLanded(result) ? submittedSignature : baselineSignature;
}

/** Leave and reload guard: ask while edits are unsaved or a save is in flight. */
export function shouldGuardUnload(state: { dirty: boolean; pending: boolean; disabled?: boolean }): boolean {
  if (state.disabled) return false;
  return state.dirty || state.pending;
}

/** beforeunload handler that asks only while shouldGuard() is true. */
export function formSaveUnloadHandler(shouldGuard: () => boolean) {
  return (event: { preventDefault: () => void; returnValue?: unknown }) => {
    if (!shouldGuard()) return;
    event.preventDefault();
    // Chrome still needs returnValue set for the native prompt.
    event.returnValue = "";
  };
}

/** Next.js navigation errors (redirect, notFound) must pass through a save. */
export function isNavigationError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("digest" in err)) return false;
  const digest = String((err as { digest?: unknown }).digest || "");
  return digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND";
}

/** A thrown save (dropped connection) becomes a result the form can show. */
export function thrownSaveResult<R extends FormSaveResult>(err: unknown): R {
  if (isNavigationError(err)) throw err;
  return { networkError: true, error: FORM_SAVE_NETWORK_ERROR } as R;
}

/**
 * How long after its own save a form keeps its mount. The save response, the
 * Realtime-driven revalidation and the router refresh each re-render the page,
 * and one of them can carry the row from before the write. Remounting on that
 * would snap the fields back to the old values and drop the Saved state.
 */
export const OWN_SAVE_SETTLE_MS = 15_000;

export type FormMountKey = {
  /** Tenant and panel: a change here always remounts. */
  scope: string;
  /** Last content fingerprint seen from props. */
  seen: string;
  /** Content fingerprint the form is mounted with. */
  mounted: string;
};

/**
 * Next mount key for a form whose props carry content fingerprints. A content
 * change right after the form's own save is the save echoing back (or a stale
 * render of it): note it, keep the mount. Any other change remounts, so edits
 * made elsewhere (a price confirmed on another card) still reach the form.
 */
export function nextFormMountKey(
  current: FormMountKey,
  next: { scope: string; content: string },
  ownSaveAt: number,
  now: number
): FormMountKey {
  if (current.scope !== next.scope) return { scope: next.scope, seen: next.content, mounted: next.content };
  if (current.seen === next.content) return current;
  const settling = ownSaveAt > 0 && now - ownSaveAt < OWN_SAVE_SETTLE_MS;
  return settling
    ? { ...current, seen: next.content }
    : { scope: next.scope, seen: next.content, mounted: next.content };
}
