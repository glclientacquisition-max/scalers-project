/**
 * Optimistic write: change the screen first, then ask the server.
 * If the server says no (or the request never lands), put the screen back
 * and hand the owner a short reason. No contract change: `commit` is the
 * same server action the control already called.
 */
export type OptimisticOutcome<R> = { ok: true; value: R } | { ok: false; error: string };

export const OPTIMISTIC_OFFLINE_ERROR = "Not saved. Check your connection and try again.";

export async function runOptimistic<R>({
  apply,
  commit,
  rollback,
  failed,
  fallback,
}: {
  /** Change the screen now. */
  apply: () => void;
  /** The server action. May resolve with an error shape or throw. */
  commit: () => Promise<R>;
  /** Undo `apply`. Runs once, only when the write did not land. */
  rollback: () => void;
  /** Read an error out of the server result. Null or empty: it landed. */
  failed?: (value: R) => string | null | undefined | false;
  /** Shown when the server failed without a reason. */
  fallback: string;
}): Promise<OptimisticOutcome<R>> {
  apply();
  let value: R;
  try {
    value = await commit();
  } catch {
    rollback();
    return { ok: false, error: OPTIMISTIC_OFFLINE_ERROR };
  }
  const reason = failed ? failed(value) : null;
  if (reason !== null && reason !== undefined && reason !== false) {
    rollback();
    const text = String(reason).trim();
    return { ok: false, error: text || fallback };
  }
  return { ok: true, value };
}

/** Server actions here return `{ error }` or `{ ok: false, error }` on failure. */
export function serverActionError(res: unknown): string | null {
  if (!res || typeof res !== "object") return null;
  const row = res as { ok?: unknown; error?: unknown };
  if (typeof row.error === "string" && row.error.trim()) return row.error;
  if (row.ok === false) return "";
  return null;
}
