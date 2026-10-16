// Tool-turn smoothness (briefs/v2-tool-turn-smoothness-voice.md §2 items 1-5).
// Umbrella VOICE_TOOL_SMOOTH (default off). Sub-flags default to the umbrella and
// can be forced on/off on their own: VOICE_TOOL_SMOOTH_{TRACE,HOLD,RECEIPT,PREFETCH,READBACK}.
// Bar: caller-heard gap between the ack/filler and the real reply on tool
// turns <= 250 ms p95, no dead air.

const ON = /^(1|true|on|yes)$/i;
const OFF = /^(0|false|off|no)$/i;
const SUBS = ['trace', 'hold', 'receipt', 'prefetch', 'readback'];
const BYTES_PER_MS = 32; // 16 kHz, 16-bit mono
const GAP_BAR_MS = 250;
const DEAD_AIR_MS = 1000;
const MERGE_MS = 20;
const HOLD_MAX = 3; // long waits (escalate e-mail ~3 s) need three short lines to stay gap-free // sends closer than this are one heard segment

function toolSmoothFlags(env = process.env) {
  const umbrella = ON.test(String(env.VOICE_TOOL_SMOOTH || '').trim());
  const out = {};
  for (const k of SUBS) {
    const raw = String(env[`VOICE_TOOL_SMOOTH_${k.toUpperCase()}`] || '').trim();
    out[k] = raw ? ON.test(raw) && !OFF.test(raw) : umbrella;
  }
  out.any = SUBS.some((k) => out[k]);
  return out;
}

function pcmMs(bytes) { return Math.round((Number(bytes) || 0) / BYTES_PER_MS); }

/**
 * Media-side playback clock. The bridge queues outbound PCM, so what the caller
 * hears is a sequence of [start,end) spans. Silence = next start - prev end.
 */
function createMediaClock({ now = () => Date.now() } = {}) {
  let queuedUntil = 0;
  /** @type {{ startMs: number, endMs: number, kind: string }[]} */
  const spans = [];
  let nextKind = 'tts';
  return {
    tag(kind) { nextKind = String(kind || 'tts'); },
    onSend(bytes) {
      const t = now();
      const dur = pcmMs(bytes);
      if (!dur) return;
      const start = Math.max(t, queuedUntil);
      const last = spans[spans.length - 1];
      if (last && start - last.endMs <= MERGE_MS && last.kind === nextKind) last.endMs = start + dur;
      else spans.push({ startMs: start, endMs: start + dur, kind: nextKind });
      queuedUntil = start + dur;
      if (spans.length > 400) spans.splice(0, spans.length - 400);
    },
    onClear() { const t = now(); queuedUntil = t; const last = spans[spans.length - 1]; if (last && last.endMs > t) last.endMs = t; },
    remainingMs() { return Math.max(0, queuedUntil - now()); },
    segmentsSince(t0) {
      const base = Number(t0) || 0;
      return spans.filter((s) => s.endMs > base).map((s) => ({ kind: s.kind, startMs: s.startMs - base, endMs: s.endMs - base }));
    },
  };
}

/** Lines to pre-render (item 4): hold pack per language (item 2) + common receipts (item 3). */
const HOLD_FILL = {
  en: ['Let me check.', 'Just a second.', 'One moment.'],
  sw: ['Naangalia.', 'Nipe sekunde.', 'Sekunde moja.'],
};
const RECEIPT_PACK = [
  "I've saved your request.", "Okay, I've saved your request.",
  "They'll call you back.", "Okay. They'll call you back.",
  "I've saved your name.", "Okay, I've saved your name.",
  'Nimehifadhi ombi lako.', 'Sawa, nimehifadhi ombi lako.',
  'Watakupigia.', 'Sawa. Watakupigia.',
];
/** Language the hold pack is keyed under: sw for sw/sheng, else en. */
function holdLanguage(lang) { return /^(sw|sheng)$/i.test(String(lang || '')) ? 'sw' : 'en'; }
function holdFillLines(lang) { return HOLD_FILL[String(lang || '').toLowerCase() === 'en' ? 'en' : (/^(sw|sheng)$/i.test(String(lang || '')) ? 'sw' : 'en')]; }
/**
 * Warm list with an explicit language per phrase (the cache key includes it): hold
 * lines first, the call's own language first, then receipts.
 */
function warmPhrases(callLanguage) {
  const first = holdLanguage(callLanguage);
  const other = first === 'sw' ? 'en' : 'sw';
  const tag = (lang) => (text) => ({ text, callLanguage: lang });
  const receipts = RECEIPT_PACK.map((text) => ({ text, callLanguage: /[a-z]'|\b(I've|They'll|Okay)\b/.test(text) ? 'en' : 'sw' }));
  return [...HOLD_FILL[first].map(tag(first)), ...HOLD_FILL[other].map(tag(other)), ...receipts];
}

/**
 * Gap-fill decision (items 1-2): queue the next cached hold line just before the
 * queued audio runs out while the tool is still pending. Max `max` per turn.
 */
function shouldQueueHold({ toolPending, remainingMs, played = 0, max = HOLD_MAX, leadMs = 150, fillerPlayed = false } = {}) {
  // Regression-9 R8 (HD_2847152f6c1e T4): a filler already played this turn owns the one
  // filler/hold slot, so no hold line stacks after it. server.js passes fillerPlayed under VOICE_FILLER_SLOT.
  if (fillerPlayed) return false;
  return Boolean(toolPending) && played < max && Number(remainingMs) <= leadMs;
}

function pctl(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/**
 * Score tool turns from heard segments. Per tool turn: the gap from the end of
 * the first heard segment (ack/filler) to the start of the next, and every
 * intra-turn silence >= DEAD_AIR_MS. turns: [{ tool: bool, segments: [{startMs,endMs,kind}], stack?: bool }]
 */
function scoreToolTurns(turns = []) {
  const gaps = []; let deadAir = 0; let stacks = 0; let toolTurns = 0;
  for (const t of turns) {
    if (!t || !t.tool) continue;
    const segs = (t.segments || []).filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs);
    if (!segs.length) continue;
    toolTurns += 1;
    if (t.stack) stacks += 1;
    // Worst silence between the first heard segment (ack/filler) and the end of the turn's audio.
    if (segs.length > 1) { let worst = 0; for (let i = 1; i < segs.length; i++) worst = Math.max(worst, segs[i].startMs - segs[i - 1].endMs); gaps.push(worst); }
    for (let i = 1; i < segs.length; i++) if (segs[i].startMs - segs[i - 1].endMs >= DEAD_AIR_MS) deadAir += 1;
  }
  const p50 = pctl(gaps, 50); const p95 = pctl(gaps, 95);
  return { toolTurns, gaps, gapP50Ms: p50, gapP95Ms: p95, deadAir, stacks, pass: (p95 == null || p95 <= GAP_BAR_MS) && deadAir === 0 && stacks === 0 };
}

module.exports = {
  GAP_BAR_MS, DEAD_AIR_MS, HOLD_MAX, RECEIPT_PACK, HOLD_FILL,
  toolSmoothFlags, pcmMs, createMediaClock, holdLanguage, holdFillLines, warmPhrases, shouldQueueHold, scoreToolTurns, pctl,
};

/**
 * Replay one logged tool turn through the same clock + gap-fill rule the live
 * path uses (fake time, 10 ms ticks). flags.hold / flags.receipt as live.
 * fixture: tests/fixtures/tool-turns/*.json
 */
function simulateToolTurn(fx, flags = {}) {
  let t = 0;
  const clock = createMediaClock({ now: () => t });
  const a = fx.assume || {}; const ttfa = a.liveTtfaMs ?? 250; const mpc = a.msPerChar ?? 75;
  const bytesFor = (text) => Math.round(String(text).length * mpc * BYTES_PER_MS);
  let holds = 0; let receiptAt = null; let receiptText = fx.receipt.text;
  const end = fx.toolDoneAtMs + ttfa + 6000;
  for (t = 0; t <= end; t += 10) {
    if (t === Math.round(fx.ack.atMs / 10) * 10) { clock.tag('filler'); clock.onSend(fx.ack.bytes); clock.tag('tts'); }
    const pending = t >= fx.ack.atMs && t < fx.toolDoneAtMs;
    if (flags.hold && pending && shouldQueueHold({ toolPending: true, remainingMs: clock.remainingMs(), played: holds })) {
      const line = holdFillLines(fx.lang)[holds]; holds += 1;
      clock.tag('hold'); clock.onSend(bytesFor(line)); clock.tag('tts');
    }
    if (t === Math.round(fx.toolDoneAtMs / 10) * 10) {
      receiptText = fx.receipt.trimmed || fx.receipt.text; // ack/hold played -> trimAckLead
      const cached = flags.receipt && RECEIPT_PACK.includes(receiptText);
      receiptAt = t + (cached ? 0 : ttfa);
    }
    if (receiptAt != null && t === receiptAt) { clock.tag('receipt'); clock.onSend(bytesFor(receiptText)); clock.tag('tts'); receiptAt = -1; }
  }
  return { tool: true, segments: clock.segmentsSince(0), holds };
}
module.exports.simulateToolTurn = simulateToolTurn;
