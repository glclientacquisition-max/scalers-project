'use strict';
// Background owner notify for escalate tasks (Brain #680 contract):
// escalate resolves when the task row exists; the owner message is queued,
// never awaited, and a failure is logged without flipping ok. A booking that
// supersedes the task cancels its still-queued notify, so the call yields one
// owner message (the booking's), not a callback email plus a booking email.

const DEFAULT_DELAY_MS = 1500;
/** @type {Map<string, { timer: any, callSid: string|null, sent: boolean }>} */
const queued = new Map();

function delayMs(env = process.env) {
  const n = Number(env.OWNER_NOTIFY_QUEUE_MS);
  return Number.isFinite(n) && n >= 0 && String(env.OWNER_NOTIFY_QUEUE_MS ?? '') !== '' ? n : DEFAULT_DELAY_MS;
}

/** Queue fn() for taskId. Returns 'queued'. Never throws, never awaited by callers. */
function queueOwnerNotify(taskId, fn, { callSid = null, delay = delayMs() } = {}) {
  const id = String(taskId || '').trim();
  if (!id || typeof fn !== 'function') return 'skipped';
  const entry = { timer: null, callSid, sent: false };
  entry.timer = setTimeout(() => {
    entry.sent = true;
    queued.delete(id);
    Promise.resolve()
      .then(fn)
      .catch((err) => console.warn(`[owner-notify] task=${id} failed:`, err?.message || err));
  }, delay);
  if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
  queued.set(id, entry);
  return 'queued';
}

/** Cancel queued (unsent) notifies for these task ids. Returns the ids cancelled. */
function cancelOwnerNotify(taskIds = []) {
  const out = [];
  for (const raw of taskIds || []) {
    const id = String(raw || '').trim();
    const entry = queued.get(id);
    if (!entry || entry.sent) continue;
    clearTimeout(entry.timer);
    queued.delete(id);
    out.push(id);
  }
  return out;
}

function isOwnerNotifyQueued(taskId) {
  return queued.has(String(taskId || '').trim());
}

function resetOwnerNotifyQueue() {
  for (const e of queued.values()) clearTimeout(e.timer);
  queued.clear();
}

module.exports = { queueOwnerNotify, cancelOwnerNotify, isOwnerNotifyQueued, resetOwnerNotifyQueue };
