/**
 * Texts the owner just sent from the call view, shown in the thread before the
 * server row exists (D3). Client only, no persistence: a reload shows only
 * what the server recorded. Honest states only: Sending, Sent (the server
 * accepted it), Not sent (it never left). Never "Delivered" from here.
 */
import type { CallMessage } from "@/lib/callMessages";
import type { TextBubble } from "@/lib/callTextThread";

export type PendingTextState = "sending" | "sent" | "failed";

export type PendingText = {
  /** The reply id the send used (ledger key), also the bubble key. */
  id: string;
  callId: string;
  callerPhone: string;
  body: string;
  /** Epoch ms when Send was tapped. */
  at: number;
  state: PendingTextState;
  reason: string | null;
};

export const OPTIMISTIC_OFFLINE_ERROR = "Check your connection.";

/** A server row this close to the tap (either side, clocks drift) can be the same text. */
export const PENDING_MATCH_WINDOW_MS = 10 * 60 * 1000;

export function pendingTextBubble(p: PendingText): TextBubble & { local: true } {
  const failed = p.state === "failed";
  return {
    id: `local:${p.id}`,
    side: "right",
    tone: "owner",
    label: null,
    body: p.body,
    statusLabel: failed ? "Not sent" : p.state === "sent" ? "Sent" : "Sending",
    ticks: p.state === "sent" ? 1 : 0,
    failed,
    reason: failed ? p.reason : null,
    canRetry: failed,
    at: new Date(p.at).toISOString(),
    local: true,
  };
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/\s+/g, " ") === b.trim().replace(/\s+/g, " ");
}

/**
 * Server bubbles first, then the local ones the server does not have yet.
 * Each server outbound row can stand in for one local text with the same
 * words sent around the same time (one to one, oldest first). `matched` are
 * local ids the server now has; the caller drops them from the store.
 */
export function mergePendingTexts(
  messages: CallMessage[],
  serverBubbles: TextBubble[],
  pending: PendingText[]
): { bubbles: TextBubble[]; matched: string[] } {
  const used = new Set<string>();
  const matched: string[] = [];
  const local: TextBubble[] = [];
  const outbound = messages.filter((m) => m.direction === "out");
  for (const p of [...pending].sort((a, b) => a.at - b.at)) {
    const hit = outbound.find((m) => {
      if (used.has(m.id) || !sameText(m.body, p.body)) return false;
      const ms = Date.parse(m.createdAt);
      return Number.isFinite(ms) && Math.abs(ms - p.at) <= PENDING_MATCH_WINDOW_MS;
    });
    if (hit) {
      used.add(hit.id);
      matched.push(p.id);
      continue;
    }
    local.push(pendingTextBubble(p));
  }
  return { bubbles: [...serverBubbles, ...local], matched };
}

/* ---- tiny store shared by the composer (writes) and the thread (reads) ---- */

let items: PendingText[] = [];
const listeners = new Set<() => void>();
const EMPTY: PendingText[] = [];
const byCall = new Map<string, PendingText[]>();

function emit() {
  byCall.clear();
  for (const listener of listeners) listener();
}

export function subscribePendingTexts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable array per call until the store changes (useSyncExternalStore safe). */
export function pendingTextsFor(callId: string): PendingText[] {
  const hit = byCall.get(callId);
  if (hit) return hit;
  const list = items.filter((p) => p.callId === callId);
  const out = list.length ? list : EMPTY;
  byCall.set(callId, out);
  return out;
}

export function addPendingText(p: Omit<PendingText, "state" | "reason">): void {
  items = [...items.filter((x) => x.id !== p.id), { ...p, state: "sending", reason: null }];
  emit();
}

export function settlePendingText(id: string, next: { state: PendingTextState; reason?: string | null }): void {
  let changed = false;
  items = items.map((p) => {
    if (p.id !== id) return p;
    changed = true;
    return { ...p, state: next.state, reason: next.reason ?? null };
  });
  if (changed) emit();
}

export function dropPendingTexts(ids: string[]): void {
  if (!ids.length) return;
  const gone = new Set(ids);
  const next = items.filter((p) => !gone.has(p.id));
  if (next.length === items.length) return;
  items = next;
  emit();
}

/** Tests only. */
export function resetPendingTexts(): void {
  items = [];
  emit();
}
