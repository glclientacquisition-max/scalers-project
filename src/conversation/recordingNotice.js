'use strict';

// Caller recording notice (Kenya Data Protection Act: tell callers before recording).
// Spoken in the opener only while VOICE_STREAM_RECORD asks SautiKit to record,
// so the notice and the recording can never drift apart.

const RECORDING_NOTICE_EN = 'This call may be recorded.';
const RECORDING_NOTICE_SW = 'Simu hii inaweza kurekodiwa.';

function recordingNoticeOn(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_STREAM_RECORD || '').trim());
}

/**
 * VOICE_RECORDING_NOTICE_OWED (default off; only the exact value 'on').
 * On: a notice cut by barge-in is owed and said once at the next agent line,
 * calls.notice_given is written only after a full play, and the notice is
 * spoken in Kiswahili when the invite is Kiswahili.
 */
function recordingNoticeOwedEnabled(env = process.env) {
  return String(env.VOICE_RECORDING_NOTICE_OWED || '').trim() === 'on';
}

const SW_INVITE =
  /\b(nikusaidie|tukusaidie|ningekusaidia|naweza|tunaweza|kukusaidia|karibu|karibuni|vipi|aje|habari|jambo|nini)\b/i;

/** 'sw' when the opener invite is Kiswahili ("Nikusaidie vipi"), else 'en'. */
function inviteNoticeLanguage(invite) {
  const text = String(invite || '').trim();
  return text && SW_INVITE.test(text) ? 'sw' : 'en';
}

/**
 * Notice sentence for the opener. Kiswahili only with the owed flag on and a
 * Kiswahili invite; otherwise today's English line.
 * @param {{ greetingInvite?: string, owedFlag?: boolean, language?: string }} [opts]
 */
function recordingNoticeLine(opts = {}) {
  const on = opts.owedFlag != null ? opts.owedFlag === true : recordingNoticeOwedEnabled();
  if (!on) return RECORDING_NOTICE_EN;
  const lang = opts.language || inviteNoticeLanguage(opts.greetingInvite);
  return lang === 'sw' ? RECORDING_NOTICE_SW : RECORDING_NOTICE_EN;
}

const MAX_OWED_ATTEMPTS = 2;

/**
 * Per-call notice state. Pure; server.js drives it.
 *   greetingPlayed({ noticeInGreeting, cut })  after the opener returns
 *   takeOwedPrefix()                            before an agent line: the
 *                                               notice to prepend, or ''
 *   owedLinePlayed({ cut })                     after that line returns
 * `onGiven(how)` runs once, when the notice has been fully played.
 */
function createRecordingNoticeState(opts = {}) {
  const line = String(opts.line || RECORDING_NOTICE_EN);
  const maxAttempts = Number.isFinite(Number(opts.maxAttempts))
    ? Number(opts.maxAttempts)
    : MAX_OWED_ATTEMPTS;
  let state = 'pending'; // pending | given | owed | not_required | gave_up
  let attempts = 0;
  let inFlight = false;

  function given(how) {
    if (state === 'given') return false;
    state = 'given';
    if (typeof opts.onGiven === 'function') {
      try {
        opts.onGiven(how);
      } catch {
        /* never throw into the media loop */
      }
    }
    return true;
  }

  function greetingPlayed({ noticeInGreeting = true, cut = false } = {}) {
    if (state !== 'pending') return state;
    if (!noticeInGreeting) {
      state = 'not_required';
      return state;
    }
    if (cut) {
      state = 'owed';
      return state;
    }
    given('greeting');
    return state;
  }

  function takeOwedPrefix() {
    if (state !== 'owed' || inFlight) return '';
    if (attempts >= maxAttempts) {
      state = 'gave_up';
      return '';
    }
    attempts += 1;
    inFlight = true;
    return line;
  }

  function owedLinePlayed({ cut = false, skipped = false } = {}) {
    if (!inFlight) return state;
    inFlight = false;
    if (state !== 'owed') return state;
    if (skipped) {
      // Nothing played (TTS failed or the line was held): no attempt used.
      attempts = Math.max(0, attempts - 1);
      return state;
    }
    if (!cut) given('owed_line');
    else if (attempts >= maxAttempts) state = 'gave_up';
    return state;
  }

  return {
    greetingPlayed,
    takeOwedPrefix,
    owedLinePlayed,
    state: () => state,
    attempts: () => attempts,
    line,
  };
}

module.exports = {
  RECORDING_NOTICE_EN,
  RECORDING_NOTICE_SW,
  MAX_OWED_ATTEMPTS,
  recordingNoticeOn,
  recordingNoticeOwedEnabled,
  inviteNoticeLanguage,
  recordingNoticeLine,
  createRecordingNoticeState,
};
