// VOICE_POST_GREETING_NUDGE (default off; only the exact value 'on' enables).
//
// After the greeting has finished playing, a caller who says nothing (or
// whose first words STT never turned into a processed turn) used to hear
// dead air for the rest of the call: the idle nudge is only armed after a
// processed caller turn (idleNudge.arm({ skip: !heardCallerUtterance })).
// Prod 19-20 Oct: HD_33121a46a2dd (70 s), HD_c9d3783bf0ea (24 s),
// HD_3837771589f0, HD_3a1bade53a21.
//
// This controller re-invites with one short line after ~6 s of silence
// following the greeting, at most twice per call. Caller speech (an interim
// or final STT event, or a barge-in) restarts the silence window, so it never
// fires while the caller is talking; a bare "Hello?" that never became a
// turn still gets a re-invite 6 s later. The first processed caller turn
// stops it for the call. It never fires while the agent is speaking or a
// turn is in flight (canFire).

const DEFAULT_DELAY_MS = 6000;
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 15000;
const MAX_NUDGES = 2;
// After the last nudge: this much more silence, then a goodbye and hang-up.
// With the ~2 s nudge line itself the caller has had >= 10 s with no speech,
// matching the approved "silent call closes after 10 s" rule (#646/#731).
const DEFAULT_CLOSE_AFTER_MS = 8000;

function postGreetingNudgeEnabled(env = process.env) {
  return String(env.VOICE_POST_GREETING_NUDGE || '').trim() === 'on';
}

function postGreetingNudgeDelayMs(env = process.env) {
  const n = Number(env.VOICE_POST_GREETING_NUDGE_MS);
  if (Number.isFinite(n) && n >= MIN_DELAY_MS && n <= MAX_DELAY_MS) return n;
  return DEFAULT_DELAY_MS;
}

const SW_INVITE =
  /\b(nikusaidie|tukusaidie|ningekusaidia|naweza|tunaweza|kukusaidia|karibu|karibuni|vipi|aje|habari|jambo|nini)\b/i;

/**
 * Language of the spoken invite: 'sw' when the invite the caller just heard
 * is Kiswahili ("Nikusaidie vipi."), otherwise 'en'.
 * @param {string} invite
 */
function inviteLanguage(invite) {
  const text = String(invite || '').trim();
  if (!text) return 'en';
  return SW_INVITE.test(text) ? 'sw' : 'en';
}

/**
 * Short re-invite. First nudge: "Hello? How can I help?". Second nudge
 * names that we are still on the line. No business facts, no vendor names.
 * @param {{ language?: string, count?: number }} opts
 */
function postGreetingNudgeLine(opts = {}) {
  const sw = String(opts.language || '').toLowerCase() === 'sw';
  const second = (Number(opts.count) || 0) > 0;
  if (sw) return second ? 'Bado niko hapa. Nikusaidie vipi?' : 'Halo? Nikusaidie vipi?';
  return second ? "I'm still here. How can I help?" : 'Hello? How can I help?';
}

/**
 * @param {{
 *   delayMs?: number,
 *   maxNudges?: number,
 *   canFire?: () => boolean,
 *   speak?: (info: { count: number }) => (void|Promise<unknown>),
 *   onSkip?: (reason: string) => void,
 *   setTimeout?: typeof setTimeout,
 *   clearTimeout?: typeof clearTimeout,
 * }} [opts]
 */
/** Goodbye before the silent hang-up, in the invite's language. */
function postGreetingGoodbyeLine(opts = {}) {
  const sw = String(opts.language || '').toLowerCase() === 'sw';
  return sw
    ? 'Sijakusikia. Tafadhali piga tena. Kwaheri.'
    : "I can't hear you. Please call again. Goodbye.";
}

function createPostGreetingNudge(opts = {}) {
  const delayMs = Number.isFinite(Number(opts.delayMs))
    ? Number(opts.delayMs)
    : postGreetingNudgeDelayMs();
  const maxNudges = Number.isFinite(Number(opts.maxNudges))
    ? Number(opts.maxNudges)
    : MAX_NUDGES;
  const closeAfterMs = Number.isFinite(Number(opts.closeAfterMs))
    ? Number(opts.closeAfterMs)
    : DEFAULT_CLOSE_AFTER_MS;
  const schedule = opts.setTimeout || setTimeout;
  const cancel = opts.clearTimeout || clearTimeout;

  let timer = null;
  let count = 0;
  let heardCaller = false;
  let closed = false;
  let speakingNudge = false;
  let closing = false;

  function clear() {
    if (timer == null) return false;
    cancel(timer);
    timer = null;
    return true;
  }

  function stopped() {
    return closed || heardCaller || closing;
  }

  function arm() {
    clear();
    if (stopped() || speakingNudge) return false;
    if (count >= maxNudges) {
      // All nudges used: the next silent window ends the call (if wired).
      if (typeof opts.goodbye !== 'function') return false;
      timer = schedule(fireGoodbye, closeAfterMs);
      return true;
    }
    timer = schedule(fire, delayMs);
    return true;
  }

  function fireGoodbye() {
    timer = null;
    if (stopped()) return;
    if (typeof opts.canFire === 'function' && !opts.canFire()) {
      if (typeof opts.onSkip === 'function') opts.onSkip('busy');
      arm();
      return;
    }
    closing = true;
    Promise.resolve()
      .then(() => opts.goodbye())
      .catch(() => {});
  }

  function fire() {
    timer = null;
    if (stopped()) return;
    if (typeof opts.canFire === 'function' && !opts.canFire()) {
      // Agent talking or a turn in flight: try again after another window.
      if (typeof opts.onSkip === 'function') opts.onSkip('busy');
      arm();
      return;
    }
    const n = count;
    count += 1;
    speakingNudge = true;
    Promise.resolve()
      .then(() => (typeof opts.speak === 'function' ? opts.speak({ count: n }) : null))
      .catch(() => {})
      .then(() => {
        speakingNudge = false;
        // Next window starts when this nudge has finished playing.
        arm();
      });
  }

  /** Greeting finished playing: start the silence window. */
  function greetingDone() {
    return arm();
  }

  /** Caller speech (interim, final, barge): restart the silence window. */
  function noteCallerSpeech() {
    if (timer == null) return false;
    return arm();
  }

  /** A processed caller turn: the conversation has started. Stop for the call. */
  function noteCallerTurn() {
    heardCaller = true;
    clear();
  }

  function close() {
    closed = true;
    clear();
  }

  return {
    greetingDone,
    noteCallerSpeech,
    noteCallerTurn,
    clear,
    close,
    count: () => count,
    closing: () => closing,
    armed: () => timer != null,
    heardCaller: () => heardCaller,
  };
}

module.exports = {
  DEFAULT_DELAY_MS,
  MAX_NUDGES,
  DEFAULT_CLOSE_AFTER_MS,
  postGreetingGoodbyeLine,
  postGreetingNudgeEnabled,
  postGreetingNudgeDelayMs,
  inviteLanguage,
  postGreetingNudgeLine,
  createPostGreetingNudge,
};
