import type { InboxItem } from "@/lib/inboxPurpose";

/**
 * Inbox redial fold. Display only: nothing here writes, merges, deletes or re-keys a call row.
 * A 0-second call with no audio and no summary, from the same caller number as a real call
 * within REDIAL_WINDOW_MS, shows as a visible child line ("0 s · hang-up") under that call
 * instead of its own row. Each call keeps its own row, minutes, recording, billing and consent.
 */
/** Ten minutes either side of the real call. */
export const REDIAL_WINDOW_MS = 10 * 60 * 1000;

export type InboxRedial = {
  /** The redial's own item / call id, unchanged. */
  id: string;
  callId: string | null;
  sid: string | null;
  createdAt: string;
  durationSeconds: 0;
};

const WITHHELD = /^(unknown|anonymous|private|withheld|restricted)$/i;

/** Last 9 digits; null when the number is withheld or too short to tell callers apart. */
export function redialCallerKey(phone: string | null | undefined): string | null {
  const raw = String(phone || "").trim();
  if (!raw || WITHHELD.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-9) : null;
}

/** A call row that is a no-audio hang-up: 0 s, no recording, no summary, no hold or visit. */
export function isNoAudioRedial(item: InboxItem): boolean {
  const call = item.lead?.call;
  if (!call || item.hold || item.job) return false;
  if (Number(call.duration_seconds ?? -1) !== 0) return false;
  if (call.recording_url) return false;
  const summary = typeof call.summary === "string" ? call.summary.trim() : call.summary;
  return !summary;
}

function at(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : NaN;
}

/**
 * Returns the display list: redials attached as `redials` on the nearest real call from the
 * same caller within the window; redials with no real neighbour stay as their own rows.
 * Input order is kept. Input items are not mutated.
 */
export function foldInboxRedials(items: InboxItem[], windowMs = REDIAL_WINDOW_MS): InboxItem[] {
  const parents = new Map<string, InboxItem[]>();
  for (const item of items) {
    if (isNoAudioRedial(item)) continue;
    const key = redialCallerKey(item.callerPhone);
    if (!key || !Number.isFinite(at(item.createdAt))) continue;
    const list = parents.get(key) || [];
    list.push(item);
    parents.set(key, list);
  }

  const childrenOf = new Map<string, InboxRedial[]>();
  const folded = new Set<string>();
  for (const item of items) {
    if (!isNoAudioRedial(item)) continue;
    const key = redialCallerKey(item.callerPhone);
    const t = at(item.createdAt);
    if (!key || !Number.isFinite(t)) continue;
    let best: InboxItem | null = null;
    let gap = Infinity;
    for (const p of parents.get(key) || []) {
      const d = Math.abs(at(p.createdAt) - t);
      if (d <= windowMs && d < gap) {
        best = p;
        gap = d;
      }
    }
    if (!best) continue;
    const list = childrenOf.get(best.id) || [];
    list.push({
      id: item.id,
      callId: item.callId,
      sid: item.lead?.call?.sautikit_call_sid ?? null,
      createdAt: item.createdAt,
      durationSeconds: 0,
    });
    childrenOf.set(best.id, list);
    folded.add(item.id);
  }

  if (!folded.size) return items;
  const out: InboxItem[] = [];
  for (const item of items) {
    if (folded.has(item.id)) continue;
    const kids = childrenOf.get(item.id);
    out.push(kids ? { ...item, redials: kids.sort((a, b) => at(a.createdAt) - at(b.createdAt)) } : item);
  }
  return out;
}
