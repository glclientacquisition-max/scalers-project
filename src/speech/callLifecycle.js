// Terminal call events seen by the HTTP webhooks, for the media socket.
//
// HD_72ab69cbab2b (staging, 2026-10-08): SautiKit posted Completed at
// 13:02:36Z, but the media socket stayed open until 13:02:41Z (code 1006),
// and the idle nudge spoke "How can I help?" at 13:02:40Z into a call that
// had already ended. The webhook notes the end here; the socket's timers
// check it before they speak.

const TTL_MS = 10 * 60 * 1000;
const terminal = new Map();

/**
 * @param {string} callSid
 * @param {{ source?: string, status?: string, at?: number }} [info]
 */
function noteCallTerminal(callSid, info = {}) {
  const sid = String(callSid || '').trim();
  if (!sid) return null;
  const row = {
    at: Number.isFinite(info.at) ? info.at : Date.now(),
    source: String(info.source || ''),
    status: String(info.status || ''),
  };
  const prev = terminal.get(sid);
  if (prev?.timer) clearTimeout(prev.timer);
  row.timer = setTimeout(() => terminal.delete(sid), TTL_MS);
  if (typeof row.timer.unref === 'function') row.timer.unref();
  terminal.set(sid, row);
  return row;
}

/**
 * The terminal event for this call, if one arrived at or after sinceMs.
 * A Completed seen before the socket opened (a set-up quirk) does not count.
 * @param {string} callSid
 * @param {number} [sinceMs]
 */
function callTerminalSince(callSid, sinceMs = 0) {
  const row = terminal.get(String(callSid || '').trim());
  if (!row) return null;
  if (Number.isFinite(sinceMs) && row.at < sinceMs) return null;
  return { at: row.at, source: row.source, status: row.status };
}

function forgetCallTerminal(callSid) {
  const sid = String(callSid || '').trim();
  const row = terminal.get(sid);
  if (row?.timer) clearTimeout(row.timer);
  terminal.delete(sid);
}

module.exports = {
  noteCallTerminal,
  callTerminalSince,
  forgetCallTerminal,
};
