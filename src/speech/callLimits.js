// Dead-air hangup and max call length (Soniox spend cut, 2026-10-24).
// VOICE_DEAD_AIR_HANGUP=on: after VOICE_DEAD_AIR_HANGUP_SEC (default 45) with
//   no voiced caller audio, no agent speech and no turn in flight, speak one
//   polite line and hang up.
// VOICE_MAX_CALL=on: at VOICE_MAX_CALL_SEC (default 1200) speak one polite
//   line and hang up.
// Both default OFF; only the exact value `on` enables them.
// A demo session may pass maxCallMs / deadAirMs. That override applies to
// that one limiter only. It does not change VOICE_MAX_CALL_SEC or the phone path.

function num(env, name, dflt, min, max) {
  const n = Number(env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : dflt;
}

function deadAirHangupOn(env = process.env) {
  return String(env.VOICE_DEAD_AIR_HANGUP ?? '').trim() === 'on';
}
function maxCallOn(env = process.env) {
  return String(env.VOICE_MAX_CALL ?? '').trim() === 'on';
}
function deadAirMs(env = process.env) {
  return num(env, 'VOICE_DEAD_AIR_HANGUP_SEC', 45, 15, 600) * 1000;
}
function maxCallMs(env = process.env) {
  return num(env, 'VOICE_MAX_CALL_SEC', 1200, 120, 7200) * 1000;
}

const LINES = {
  en: {
    deadAir: "I can't hear anything, so I'll end the call now. Please call back anytime. Goodbye.",
    maxCall: "We've reached the time limit for this call. Please call back if you need anything else. Goodbye.",
  },
  sw: {
    deadAir: 'Sisikii chochote, kwa hivyo nitakata simu sasa. Karibu upige tena wakati wowote. Kwaheri.',
    maxCall: 'Tumefika mwisho wa muda wa simu hii. Karibu upige tena ukihitaji chochote. Kwaheri.',
  },
};

function limitLine(kind, language) {
  const pack = LINES[language === 'sw' ? 'sw' : 'en'];
  return pack[kind] || pack.deadAir;
}

/**
 * @param {{
 *   canFire?: () => boolean,       // false while agent speaks / turn busy / call over
 *   onLimit: (kind: 'deadAir'|'maxCall') => unknown,
 *   onTick?: () => boolean,        // return true to skip the limit check (demo kill / cap)
 *   maxCallMs?: number,            // per session. Enables max for this limiter only.
 *   deadAirMs?: number,            // per session. Enables dead air for this limiter only.
 *   env?: object, now?: () => number, tickMs?: number,
 *   setInterval?: typeof setInterval, clearInterval?: typeof clearInterval,
 * }} opts
 */
function createCallLimits(opts) {
  const env = opts.env || process.env;
  const now = opts.now || (() => Date.now());
  const hasMax = Number.isFinite(opts.maxCallMs) && opts.maxCallMs > 0;
  const hasDead = Number.isFinite(opts.deadAirMs) && opts.deadAirMs > 0;
  const dead = hasDead || deadAirHangupOn(env);
  const max = hasMax || maxCallOn(env);
  const deadMs = hasDead ? opts.deadAirMs : deadAirMs(env);
  const maxMs = hasMax ? opts.maxCallMs : maxCallMs(env);
  const startedAt = now();
  let lastActivity = startedAt;
  let fired = null;
  let timer = null;

  function activity() {
    lastActivity = now();
  }

  function check() {
    if (fired) return null;
    if (typeof opts.onTick === 'function') {
      let halt = false;
      try { halt = opts.onTick() === true; } catch { halt = false; }
      if (halt) return fired;
    }
    const t = now();
    if (max && t - startedAt >= maxMs) fired = 'maxCall';
    else if (dead && t - lastActivity >= deadMs) {
      if (typeof opts.canFire === 'function' && !opts.canFire()) {
        lastActivity = t; // agent speaking or turn busy counts as activity
        return null;
      }
      fired = 'deadAir';
    }
    if (fired) {
      stop();
      Promise.resolve().then(() => opts.onLimit(fired)).catch(() => {});
    }
    return fired;
  }

  function start() {
    if (timer || (!dead && !max)) return false;
    const si = opts.setInterval || setInterval;
    timer = si(check, opts.tickMs || 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return true;
  }

  function stop() {
    if (!timer) return;
    (opts.clearInterval || clearInterval)(timer);
    timer = null;
  }

  return { start, stop, activity, check, get fired() { return fired; }, enabled: dead || max };
}

module.exports = { deadAirHangupOn, maxCallOn, deadAirMs, maxCallMs, limitLine, createCallLimits, LINES };
