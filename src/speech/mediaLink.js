'use strict';

/**
 * Media link hardening (HD_ad18fd9088e0, HD_60e56c6acc88: media WS connected
 * 4.5-6 s after answer, ±0.3 s jitter, 1006 closes).
 *
 * 1. createPcmPacer: VOICE_MEDIA_PACING (default off). Outbound PCM goes out
 *    as 20 ms frames with about 200 ms lead over real time instead of one
 *    burst per TTS chunk. flush() drops everything still queued (barge-in).
 *    Off: server.js sends every frame at once, exactly as before.
 * 2. createMediaLinkStats: always on, logs only. Connect delay after answer,
 *    caller-audio stalls over 1.5 s while the link is open (alert line), WS
 *    ping RTT, and per-reply send-buffer size. It never touches audio.
 */

const FRAME_MS = 20;
const FRAME_BYTES = 640; // 20 ms of mono pcm_s16le @ 16 kHz
const LEAD_MS = 200;
const STALL_MS = 1500;
const REPLY_GAP_MS = 1000;
const CONNECT_SLOW_MS = 3000;

function mediaPacingEnabled(env = process.env) {
  // process.env.VOICE_MEDIA_PACING (default off)
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_MEDIA_PACING || '').trim());
}

/**
 * @param {{ send: (frame: Buffer) => void, frameBytes?: number, frameMs?: number,
 *   leadMs?: number, now?: () => number, setTimer?: Function, clearTimer?: Function,
 *   onError?: (err: Error) => void }} opts
 */
function createPcmPacer(opts = {}) {
  const send = opts.send;
  const frameBytes = opts.frameBytes || FRAME_BYTES;
  const frameMs = opts.frameMs || FRAME_MS;
  const leadMs = opts.leadMs == null ? LEAD_MS : opts.leadMs;
  const now = opts.now || Date.now;
  const setTimer = opts.setTimer || ((fn, ms) => setInterval(fn, ms));
  const clearTimer = opts.clearTimer || ((t) => clearInterval(t));
  const queue = [];
  let playheadAt = 0; // when the far end finishes what we have sent
  let timer = null;
  let closed = false;
  const stats = { framesQueued: 0, framesSent: 0, framesFlushed: 0, underruns: 0, maxQueued: 0 };

  function stopTimer() {
    if (timer != null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function pump() {
    if (closed) return;
    const t = now();
    if (queue.length && playheadAt < t) {
      if (playheadAt > 0 && stats.framesSent > 0) stats.underruns += 1;
      playheadAt = t;
    }
    while (queue.length && playheadAt - t < leadMs) {
      const frame = queue.shift();
      try {
        send(frame);
      } catch (err) {
        queue.length = 0;
        stopTimer();
        if (opts.onError) opts.onError(err);
        return;
      }
      stats.framesSent += 1;
      playheadAt += frameMs;
    }
    if (!queue.length) stopTimer();
  }

  function enqueue(pcm) {
    if (closed || !pcm || !pcm.length) return;
    for (let offset = 0; offset < pcm.length; offset += frameBytes) {
      queue.push(pcm.subarray(offset, offset + frameBytes));
      stats.framesQueued += 1;
    }
    if (queue.length > stats.maxQueued) stats.maxQueued = queue.length;
    pump();
    if (queue.length && timer == null) timer = setTimer(pump, frameMs);
  }

  /** Barge-in: drop every queued frame. Returns how many were dropped. */
  function flush() {
    const dropped = queue.length;
    queue.length = 0;
    stats.framesFlushed += dropped;
    playheadAt = 0;
    stopTimer();
    return dropped;
  }

  function close() {
    flush();
    closed = true;
  }

  return {
    enqueue,
    flush,
    close,
    pump,
    queuedFrames: () => queue.length,
    leadMs: () => Math.max(0, playheadAt - now()),
    stats: () => ({ ...stats }),
  };
}

/**
 * Per-call link stats. Logs only.
 * @param {{ log?: Function, warn?: Function, now?: () => number, label?: () => string }} opts
 */
function createMediaLinkStats(opts = {}) {
  const now = opts.now || Date.now;
  const log = opts.log || ((m) => console.log(m));
  const warn = opts.warn || ((m) => console.warn(m));
  const label = opts.label || (() => 'unknown');
  const tag = () => `[ws/media][${label()}] media link`;
  const s = {
    connectDelayMs: null,
    lastInboundAt: null,
    stallStartedAt: null,
    stalls: 0,
    maxStallMs: 0,
    rtts: [],
    pingSentAt: null,
    replies: 0,
    reply: null,
    maxBuffered: 0,
  };

  function noteConnect({ answeredAt, connectedAt }) {
    if (!answeredAt || !connectedAt) return null;
    s.connectDelayMs = Math.max(0, connectedAt - answeredAt);
    const line = `${tag()} connect_delay=${s.connectDelayMs}ms`;
    if (s.connectDelayMs >= CONNECT_SLOW_MS) warn(`${line} slow (>=${CONNECT_SLOW_MS}ms)`);
    else log(line);
    return s.connectDelayMs;
  }

  function noteInbound() {
    const t = now();
    if (s.stallStartedAt != null) {
      const gap = t - s.stallStartedAt;
      if (gap > s.maxStallMs) s.maxStallMs = gap;
      log(`${tag()} caller audio resumed after ${gap}ms`);
      s.stallStartedAt = null;
    }
    s.lastInboundAt = t;
  }

  function notePingSent() {
    s.pingSentAt = now();
  }

  function notePong() {
    if (s.pingSentAt == null) return null;
    const rtt = now() - s.pingSentAt;
    s.pingSentAt = null;
    s.rtts.push(rtt);
    if (s.rtts.length > 200) s.rtts.shift();
    log(`${tag()} ping_rtt=${rtt}ms`);
    return rtt;
  }

  function noteSend(bytes, bufferedAmount) {
    const t = now();
    if (!s.reply) s.reply = { startedAt: t, lastAt: t, bytes: 0, sends: 0, maxBuffered: 0 };
    s.reply.lastAt = t;
    s.reply.bytes += bytes || 0;
    s.reply.sends += 1;
    const b = Number(bufferedAmount) || 0;
    if (b > s.reply.maxBuffered) s.reply.maxBuffered = b;
    if (b > s.maxBuffered) s.maxBuffered = b;
  }

  function endReply(extra = '') {
    const r = s.reply;
    if (!r) return null;
    s.reply = null;
    s.replies += 1;
    const audioMs = Math.round(r.bytes / (FRAME_BYTES / FRAME_MS));
    log(
      `${tag()} reply n=${s.replies} audio=${audioMs}ms sends=${r.sends} send_ms=${r.lastAt - r.startedAt} max_buffered=${r.maxBuffered}B${extra}`
    );
    return r;
  }

  /**
   * Call every ~250 ms while the socket is open. Raises one alert per caller
   * audio stall over STALL_MS and closes a reply after REPLY_GAP_MS of no sends.
   */
  function tick({ open = true } = {}) {
    const t = now();
    if (open && s.lastInboundAt != null && s.stallStartedAt == null && t - s.lastInboundAt > STALL_MS) {
      s.stallStartedAt = s.lastInboundAt;
      s.stalls += 1;
      warn(`[alert] ${tag()} caller audio stalled >${STALL_MS}ms while open (stall #${s.stalls})`);
    }
    if (s.reply && t - s.reply.lastAt >= REPLY_GAP_MS) endReply();
  }

  function summary({ code, paced, pacer } = {}) {
    endReply();
    if (s.stallStartedAt != null) {
      const gap = now() - s.stallStartedAt;
      if (gap > s.maxStallMs) s.maxStallMs = gap;
    }
    const r = s.rtts;
    const rtt = r.length
      ? `${Math.min(...r)}/${Math.round(r.reduce((a, b) => a + b, 0) / r.length)}/${Math.max(...r)}(${r.length})`
      : 'none';
    const p = pacer ? ` frames_sent=${pacer.framesSent} flushed=${pacer.framesFlushed} underruns=${pacer.underruns}` : '';
    const line =
      `${tag()} summary code=${code == null ? '?' : code} connect_delay=${s.connectDelayMs == null ? '?' : `${s.connectDelayMs}ms`}` +
      ` stalls=${s.stalls} max_stall=${s.maxStallMs}ms rtt_ms=${rtt} replies=${s.replies} max_buffered=${s.maxBuffered}B paced=${paced ? 'on' : 'off'}${p}`;
    log(line);
    return line;
  }

  return { noteConnect, noteInbound, notePingSent, notePong, noteSend, endReply, tick, summary, state: () => s };
}

module.exports = {
  FRAME_MS,
  FRAME_BYTES,
  LEAD_MS,
  STALL_MS,
  REPLY_GAP_MS,
  CONNECT_SLOW_MS,
  mediaPacingEnabled,
  createPcmPacer,
  createMediaLinkStats,
};
