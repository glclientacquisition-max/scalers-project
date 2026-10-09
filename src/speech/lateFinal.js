// A final that lands in the barge grace window belongs to the next caller
// turn. The closed turn is not reopened. The token is not dropped.

const DEFAULT_WINDOW_MS = 400;

function createLateFinalHold({ windowMs = DEFAULT_WINDOW_MS } = {}) {
  let carry = '';
  let closedAt = 0;

  function noteClosed(now = Date.now()) {
    closedAt = Number(now) || 0;
  }

  /**
   * @param {string} text
   * @param {{ now?: number, reason?: string }} [opts]
   * @returns {boolean}
   */
  function hold(text, opts = {}) {
    const sample = String(text || '').replace(/\s+/g, ' ').trim();
    if (!sample) return false;
    const reason = String(opts.reason || '');
    if (reason === 'echo' || reason === 'empty' || reason === 'backchannel') return false;
    const now = opts.now != null ? Number(opts.now) : Date.now();
    const age = closedAt ? now - closedAt : Infinity;
    const inWindow = Boolean(closedAt) && age >= 0 && age <= windowMs;
    // Grace and any other non-echo drop share one post-close window.
    // A final minutes later does not attach to the next caller turn.
    if (!inWindow) return false;
    carry = carry ? `${carry} ${sample}` : sample;
    return true;
  }

  function merge(text) {
    const held = carry;
    carry = '';
    const body = String(text || '').replace(/\s+/g, ' ').trim();
    if (!held) return body;
    if (!body) return held;
    if (body.toLowerCase().includes(held.toLowerCase())) return body;
    return `${held} ${body}`.replace(/\s+/g, ' ').trim();
  }

  function peek() {
    return carry;
  }

  return { noteClosed, hold, merge, peek };
}

/**
 * Separate caller finals keep a word boundary (ported from #609 edfe8447).
 * "kuosha" + "carpet." stays "kuosha carpet." A token that already
 * starts or ends with space is not spaced twice.
 * @param {string[]|string} parts
 */
function joinCallerFragments(parts) {
  const rows = Array.isArray(parts) ? parts : [parts];
  let out = '';
  for (const part of rows) {
    const next = String(part || '');
    if (!next) continue;
    if (!out) {
      out = next;
      continue;
    }
    const continuation = /[-'’]$/.test(out);
    const needsSpace =
      !/\s$/.test(out) &&
      !/^\s/.test(next) &&
      !continuation &&
      /^[\p{L}\p{N}]/u.test(next);
    out += needsSpace ? ` ${next}` : next;
  }
  return out.replace(/\s+/g, ' ').trim();
}

module.exports = {
  DEFAULT_WINDOW_MS,
  createLateFinalHold,
  joinCallerFragments,
};
