// Caller audio that predates the greeting must not cancel the greeting.
//
// Prod HD_d3900cbf2b2d (Aris, 2026-10-09 20:18 EAT): SautiKit opened /ws/media
// and delivered a 39,040-byte first frame (about 1.2 s of 16 kHz PCM16 queued
// while the leg was set up), then normal 640-byte frames. Soniox transcribed
// that queued audio late ("And I'm not", tokens 720-1020 ms on the STT clock)
// and the interim arrived 340 ms after the greeting's first PCM, so barge-in
// cancelled the greeting. Every word of that sentence (720-2100 ms) was spoken
// before the greeting started (~2330 ms on the STT clock).
//
// Two independent guards:
//  1. createInitialBurstGate: the oversized first frame(s) that arrive before
//     any normal frame and before the greeting plays are drained (not sent to
//     STT). VOICE_DRAIN_INITIAL_BURST=off keeps them.
//  2. prerollFilter: while the greeting is playing, only STT tokens whose
//     audio started at or after the greeting's first PCM can barge. Speech
//     that began before the greeting is still transcribed and queued for the
//     first turn; it just cannot cut the greeting. Real barge-in (new words
//     after the greeting started) is unchanged and still goes through
//     decideCallerEvent (#625's lone wait-word rule included).

const PCM_BYTES_PER_MS = 32; // 16 kHz mono PCM16
const NORMAL_FRAME_BYTES = 640; // 20 ms
const DEFAULT_BURST_MIN_BYTES = NORMAL_FRAME_BYTES * 4; // anything >= 80 ms in one frame
const DEFAULT_DRAIN_WINDOW_MS = 1500;

function drainInitialBurstEnabled(env = process.env) {
  const raw = String(env.VOICE_DRAIN_INITIAL_BURST || 'on').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

function greetingPrerollGuardEnabled(env = process.env) {
  const raw = String(env.VOICE_GREETING_PREROLL_GUARD || 'on').trim().toLowerCase();
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

function pcmBytesToMs(bytes) {
  return Math.round((Number(bytes) || 0) / PCM_BYTES_PER_MS);
}

/**
 * Decide, frame by frame, whether inbound caller audio goes to STT.
 * Only the leading burst is drained: frames >= burstMinBytes that arrive
 * before the first normal-size frame, before the greeting's first PCM, and
 * within drainWindowMs of the socket opening. Once a normal frame or the
 * greeting has been seen, every frame passes.
 *
 * @param {{ enabled?: boolean, burstMinBytes?: number, drainWindowMs?: number, now?: () => number }} [opts]
 */
function createInitialBurstGate(opts = {}) {
  const enabled = opts.enabled != null ? Boolean(opts.enabled) : drainInitialBurstEnabled();
  const burstMinBytes = Math.max(NORMAL_FRAME_BYTES + 1, Number(opts.burstMinBytes) || DEFAULT_BURST_MIN_BYTES);
  const windowMs = Math.max(0, Number(opts.drainWindowMs ?? DEFAULT_DRAIN_WINDOW_MS));
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const openedAt = now();
  let settled = !enabled;
  let drainedBytes = 0;
  let drainedFrames = 0;
  let passedBytes = 0;

  return {
    /**
     * @param {number} byteLength
     * @param {{ greetingStarted?: boolean }} [ctx]
     * @returns {{ forward: boolean, drained: boolean }}
     */
    admit(byteLength, ctx = {}) {
      const len = Math.max(0, Number(byteLength) || 0);
      if (!settled) {
        const late = now() - openedAt > windowMs;
        if (late || ctx.greetingStarted || len < burstMinBytes) {
          settled = true;
        } else {
          drainedBytes += len;
          drainedFrames += 1;
          return { forward: false, drained: true };
        }
      }
      passedBytes += len;
      return { forward: true, drained: false };
    },
    get drainedBytes() {
      return drainedBytes;
    },
    get drainedMs() {
      return pcmBytesToMs(drainedBytes);
    },
    get drainedFrames() {
      return drainedFrames;
    },
    /** Audio ms that reached STT (the Soniox token clock). */
    get forwardedMs() {
      return pcmBytesToMs(passedBytes);
    },
    get settled() {
      return settled;
    },
  };
}

/**
 * Keep only the words that started at or after the greeting's first PCM.
 * Tokens without timing are kept (fail open: old behaviour).
 *
 * @param {Array<{ text?: string, startMs?: number|null }>} tokens
 * @param {{ prerollMs?: number|null, greetingPlaying?: boolean, enabled?: boolean }} ctx
 * @returns {{ text: string, preroll: boolean, droppedText: string, applied: boolean }}
 */
function prerollFilter(tokens, ctx = {}) {
  const enabled = ctx.enabled != null ? Boolean(ctx.enabled) : greetingPrerollGuardEnabled();
  const list = Array.isArray(tokens) ? tokens : [];
  // Infinity: the greeting is armed but no PCM has reached the caller yet, so
  // every word so far predates it.
  const prerollMs = ctx.prerollMs === Infinity ? Infinity : Number(ctx.prerollMs);
  const joined = list.map((t) => String(t?.text || '')).join('');
  if (
    !enabled ||
    !ctx.greetingPlaying ||
    ctx.prerollMs == null ||
    !(prerollMs >= 0) ||
    !list.length
  ) {
    return { text: joined.trim(), preroll: false, droppedText: '', applied: false };
  }
  let kept = '';
  let dropped = '';
  let timed = 0;
  for (const token of list) {
    const text = String(token?.text || '');
    const start = token?.startMs;
    if (start == null || !Number.isFinite(Number(start))) {
      kept += text;
      continue;
    }
    timed += 1;
    if (Number(start) >= prerollMs) kept += text;
    else dropped += text;
  }
  if (!timed) return { text: joined.trim(), preroll: false, droppedText: '', applied: false };
  const keptText = kept.replace(/\s+/g, ' ').trim();
  return {
    text: keptText,
    preroll: !keptText && Boolean(dropped.trim()),
    droppedText: dropped.replace(/\s+/g, ' ').trim(),
    applied: true,
  };
}

module.exports = {
  PCM_BYTES_PER_MS,
  NORMAL_FRAME_BYTES,
  DEFAULT_BURST_MIN_BYTES,
  drainInitialBurstEnabled,
  greetingPrerollGuardEnabled,
  pcmBytesToMs,
  createInitialBurstGate,
  prerollFilter,
};
