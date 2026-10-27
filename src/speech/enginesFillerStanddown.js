'use strict';
const UNCUTTABLE_CAP_MS = 2000;
// BRAIN_ENGINES (#975) filler stand-down for the v2-owned media turn. One filler per turn, first one wins.
//
// With BRAIN_ENGINES on, the Brain emits ONE topic filler at BRAIN_ENGINES_FILLER_MS (700) through the same
// onSentence callback as the reply lines, marked { filler: true }. Voice's own v1-draft filler (Sawa-style
// contextual ack, brainV1Draft.DEADLINES.fillerMs = 900) is armed on the same turn. Without this gate:
//   - a Brain filler counted as the turn's first spoken line (timing + "first" cut logic ran on the filler);
//   - it played through speakText as a reply line, so the first real line could not cut it like a filler;
//   - if Voice's filler fired first (Brain filler later than 900 ms), the caller heard two fillers.
// This gate: Brain filler cancels Voice's pending filler; a Brain filler after Voice's filler is dropped;
// the Brain filler plays as a filler (cut-for-reply / barge rules); a streamed:true result is never re-spoken.
// uncuttable:true on the Brain filler (#975 contract): the ready reply waits for the filler to finish instead of
// the Phase A min-playout cut; caller barge-in still cuts it; a stuck filler is cut at UNCUTTABLE_CAP_MS playout.
// The filler never joins the transcript or live.line (server.js pushes live.line only).
// Off (BRAIN_ENGINES off, or not the BRAIN_MODEL_LEAD path) = server.js runs today's code; this is not used.

/**
 * @param {object} o
 * @param {number} o.fillerMs                  Voice filler delay (brainV1Draft.DEADLINES.fillerMs)
 * @param {() => boolean} o.isBarged           caller speech in progress (bargeInActive)
 * @param {() => (string|null)} o.pickVoiceFiller
 * @param {(text: string, src: 'voice'|'brain') => (Promise<any>|void)} o.playFiller  filler playback; the
 *        promise settles when the filler has played out (used only to wait out an uncuttable filler)
 * @param {(text: string) => Promise<any>} o.speakLine                   a real reply line
 * @param {() => Promise<any>} [o.cutFillerForReply]                   Phase A cut before the first real line
 * @param {boolean} [o.phaseA]
 * @param {() => void} [o.markFiller]
 * @param {() => void} [o.markFirstSpokenChunk]
 * @param {(msg: string) => void} [o.log]
 * @param {number} [o.uncuttableCapMs]       safety cap on an uncuttable filler's playout (2000)
 * @param {() => number} [o.now]
 */
function createEnginesFillerTurn({
  fillerMs,
  isBarged = () => false,
  pickVoiceFiller,
  playFiller,
  speakLine,
  cutFillerForReply = async () => null,
  phaseA = true,
  markFiller = () => {},
  markFirstSpokenChunk = () => {},
  log = () => {},
  schedule = setTimeout,
  cancelTimer = clearTimeout,
  uncuttableCapMs = UNCUTTABLE_CAP_MS,
  bargePollMs = 40,
  now = Date.now,
} = {}) {
  let timer = null;
  let filler = null; // { src: 'voice'|'brain', text, uncuttable, at, done }
  let real = 0;
  let chain = Promise.resolve();
  const dropped = [];

  function cancel() {
    if (timer) { cancelTimer(timer); timer = null; }
  }

  function arm() {
    cancel();
    timer = schedule(() => {
      timer = null;
      if (real || filler || isBarged()) return;
      const f = pickVoiceFiller ? pickVoiceFiller() : null;
      if (!f) return;
      filler = { src: 'voice', text: f };
      markFiller();
      log(`brain_v1_draft filler at=${fillerMs}ms: ${f}`);
      playFiller(f, 'voice');
    }, fillerMs);
    return timer;
  }

  function onSentence(s) {
    if (!s || !s.text) return;
    if (s.filler === true) {
      cancel(); // the Brain spoke for this wait: Voice's 900 ms filler stands down
      if (filler || real || isBarged()) {
        const why = filler ? `${filler.src}_filler_already` : real ? 'reply_started' : 'barge_in';
        dropped.push({ text: s.text, why });
        log(`brain_engines filler dropped (${why}): ${s.text}`);
        return;
      }
      const uncuttable = s.uncuttable === true;
      filler = { src: 'brain', text: s.text, uncuttable, at: now(), done: false };
      markFiller();
      log(`brain_engines filler (voice filler stood down${uncuttable ? ', uncuttable' : ''}): ${s.text}`);
      const f = filler;
      let p;
      try { p = playFiller(s.text, 'brain'); } catch { p = null; }
      f.played = Promise.resolve(p).catch(() => null).then(() => { f.done = true; });
      return;
    }
    cancel();
    if (!real) markFirstSpokenChunk();
    real += 1;
    const first = real === 1;
    chain = chain
      .then(() => (phaseA && first ? beforeFirstLine() : null))
      .then(() => (isBarged() ? { ok: false, barged: true } : speakLine(s.text)))
      .catch(() => ({ ok: false }));
  }

  // Reply ready: an uncuttable Brain filler plays out (barge-in or the cap cut it); anything else = Phase A cut.
  function beforeFirstLine() {
    const f = filler;
    if (!f || f.src !== 'brain' || !f.uncuttable) return cutFillerForReply();
    if (f.done) return null;
    return new Promise((resolve) => {
      let capT = null; let pollT = null; let settled = false;
      const end = (why) => {
        if (settled) return; settled = true;
        if (capT) cancelTimer(capT);
        if (pollT) cancelTimer(pollT);
        resolve(why);
      };
      f.played.then(() => end('played'));
      const left = Math.max(0, uncuttableCapMs - (now() - f.at));
      capT = schedule(() => {
        capT = null;
        if (settled || f.done) return;
        log(`brain_engines uncuttable filler cap: cut after ${now() - f.at}ms playout (cap ${uncuttableCapMs}ms): ${f.text}`);
        Promise.resolve().then(() => cutFillerForReply()).catch(() => null).then(() => end('cap'));
      }, left);
      // barge-in keeps its own cut (server.js); stop waiting so the line check sees it at once
      const poll = () => { pollT = null; if (settled) return; if (isBarged()) return end('barge'); pollT = schedule(poll, bargePollMs); };
      pollT = schedule(poll, bargePollMs);
    });
  }

  /**
   * After the Brain turn returns. streamed:true = every line already went through onSentence: never re-speak.
   * Returns null when the caller should use its non-streamed speak path, else { spoken } (the last streamed
   * line's speak result; { ok: false, empty: true } when the Brain streamed no reply line, e.g. barge-in).
   */
  async function finish(live) {
    cancel();
    if (!live || live.streamed !== true) return null;
    if (real) return { spoken: await chain };
    return { spoken: { ok: false, empty: true, streamed: true } };
  }

  return {
    arm,
    cancel,
    onSentence,
    finish,
    get filler() { return filler; },
    get realLines() { return real; },
    get dropped() { return dropped.slice(); },
  };
}

module.exports = { createEnginesFillerTurn, UNCUTTABLE_CAP_MS };
