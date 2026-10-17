'use strict';

/**
 * Process-level safety net for the Voice server.
 *
 * unhandledRejection: log and keep running. One stray promise (a Soniox
 * socket, a notify send, a Supabase write) must not take down every live call
 * on the box (13 Oct Esga: one rejected TTS line crashed Node). Each distinct
 * signature logs once in full; repeats inside the window are counted and
 * summarised on the next occurrence after the window, so a hot loop cannot
 * flood the logs.
 *
 * uncaughtException: stays fatal. Process state is unknown after a synchronous
 * throw escaped, so log it and exit(1); Railway restarts the service.
 *
 * Sources should still catch their own rejections. This is the last line, and
 * every hit here is a bug to fix at its source.
 */

const DEFAULT_WINDOW_MS = 60_000;
const MAX_SIGNATURES = 500;

function firstStackFrame(stack) {
  const lines = String(stack || '').split('\n').slice(1);
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('at ')) continue;
    if (t.includes('node:internal') || t.includes('(internal/')) continue;
    // Drop line/column so one site with shifting columns stays one signature.
    return t.replace(/:\d+:\d+\)?$/, '').replace(/^at /, '');
  }
  return '';
}

/**
 * Stable signature for a rejection reason: error name, message with volatile
 * numbers / ids masked, and the first non-internal stack frame.
 * @param {unknown} reason
 */
function rejectionSignature(reason) {
  if (reason instanceof Error || (reason && typeof reason === 'object' && 'message' in reason)) {
    const name = String(reason.name || reason.constructor?.name || 'Error');
    const code = reason.code != null ? `[${String(reason.code)}]` : '';
    const msg = String(reason.message || '')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '<id>')
      .replace(/\b(?:CA|HD_)?[0-9a-f]{10,}\b/gi, '<id>')
      .replace(/\d+/g, 'N')
      .slice(0, 200);
    return `${name}${code}: ${msg} @ ${firstStackFrame(reason.stack)}`;
  }
  let text;
  try {
    text = typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    text = String(reason);
  }
  return `non-error(${typeof reason}): ${String(text).replace(/\d+/g, 'N').slice(0, 200)}`;
}

/**
 * Rate limiter keyed by signature. Pure; exported for tests.
 * @param {{ windowMs?: number, now?: () => number, maxSignatures?: number }} [opts]
 */
function createSignatureLimiter(opts = {}) {
  const windowMs = Number.isFinite(opts.windowMs) ? opts.windowMs : DEFAULT_WINDOW_MS;
  const now = opts.now || Date.now;
  const maxSignatures = opts.maxSignatures || MAX_SIGNATURES;
  /** @type {Map<string, { first: number, lastLogged: number, suppressed: number, total: number }>} */
  const seen = new Map();

  /**
   * @returns {{ log: boolean, first: boolean, suppressed: number, total: number }}
   */
  function hit(signature) {
    const t = now();
    let row = seen.get(signature);
    if (!row) {
      if (seen.size >= maxSignatures) {
        const oldest = seen.keys().next().value;
        seen.delete(oldest);
      }
      row = { first: t, lastLogged: t, suppressed: 0, total: 1 };
      seen.set(signature, row);
      return { log: true, first: true, suppressed: 0, total: 1 };
    }
    row.total += 1;
    if (t - row.lastLogged >= windowMs) {
      const suppressed = row.suppressed;
      row.suppressed = 0;
      row.lastLogged = t;
      return { log: true, first: false, suppressed, total: row.total };
    }
    row.suppressed += 1;
    return { log: false, first: false, suppressed: row.suppressed, total: row.total };
  }

  return { hit, size: () => seen.size };
}

function describe(reason) {
  if (reason instanceof Error) return reason.stack || `${reason.name}: ${reason.message}`;
  try {
    return typeof reason === 'string' ? reason : JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Install the handlers once per process. Returns the handlers for tests.
 * @param {{
 *   proc?: NodeJS.Process,
 *   log?: { error: Function, warn: Function },
 *   windowMs?: number,
 *   now?: () => number,
 *   exit?: (code: number) => void,
 * }} [opts]
 */
function installProcessGuards(opts = {}) {
  const proc = opts.proc || process;
  const log = opts.log || console;
  const exit = opts.exit || ((code) => proc.exit(code));
  if (proc.__scalersProcessGuards) return proc.__scalersProcessGuards;
  const limiter = createSignatureLimiter({ windowMs: opts.windowMs, now: opts.now });

  function onUnhandledRejection(reason) {
    try {
      const sig = rejectionSignature(reason);
      const verdict = limiter.hit(sig);
      if (!verdict.log) return;
      if (verdict.first) {
        log.error(
          `[process] unhandledRejection (kept running; fix at source) sig="${sig}"\n${describe(reason)}`
        );
      } else {
        log.warn(
          `[process] unhandledRejection again sig="${sig}" suppressed=${verdict.suppressed} total=${verdict.total}`
        );
      }
    } catch {
      /* the safety net itself must never throw */
    }
  }

  function onUncaughtException(err, origin) {
    try {
      log.error(
        `[process] uncaughtException origin=${origin || 'uncaughtException'} (fatal, exiting 1)\n${describe(err)}`
      );
    } catch {
      /* ignore */
    }
    exit(1);
  }

  proc.on('unhandledRejection', onUnhandledRejection);
  proc.on('uncaughtException', onUncaughtException);
  const handle = { onUnhandledRejection, onUncaughtException, limiter };
  proc.__scalersProcessGuards = handle;
  return handle;
}

module.exports = {
  installProcessGuards,
  createSignatureLimiter,
  rejectionSignature,
  DEFAULT_WINDOW_MS,
};
