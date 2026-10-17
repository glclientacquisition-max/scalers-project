// src/speech/sonioxTts.js
// Soniox realtime TTS over WebSocket. Emits pcm_s16le chunks for SautiKit.

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const { prepareForTts } = require('./ttsNormalize');
const { wireTextForPiece } = require('./ttsBoundary');
const { resolveSonioxVoice, resolveSonioxTtsModel } = require('./sonioxVoice');
const { classifySonioxError } = require('./sonioxErrors');
const {
  noteSonioxProviderError,
  noteSonioxProviderOk,
} = require('./sonioxProviderHealth');
const {
  clampSpeed,
  resolveVoiceProfile,
  speedForLanguage,
} = require('./voiceProfile');

const SONIOX_TTS_URL =
  process.env.SONIOX_TTS_URL || 'wss://tts-rt.soniox.com/tts-websocket';
const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);

function isSonioxTtsConfigured() {
  return Boolean(process.env.SONIOX_API_KEY);
}

// VOICE_TTS_RESPEAK (default on): a Soniox socket close or transient stream
// error mid-line reconnects once and speaks that same line again from the
// start. If the reconnect fails or times out, the line goes to the fallback
// chain the caller passed in (fallbackPcm). Live miss 13 Oct (Esga,
// HD_116ff6a67508 + HD_1e4e3e955169): Soniox closed an idle socket with
// 1001 "Timeout" under a prefetched reply stream. The rejected line had no
// handler, so Node crashed and the caller heard silence until they hung up.
function isTtsRespeakEnabled() {
  const raw = String(process.env.VOICE_TTS_RESPEAK ?? 'on').trim().toLowerCase();
  return raw !== 'off' && raw !== '0' && raw !== 'false';
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Bounded reconnect for a re-speak, in ms. */
function respeakConnectMs() {
  return positiveInt(process.env.VOICE_TTS_RESPEAK_CONNECT_MS, 1500);
}

/** Re-speaks allowed per call (one per line). Stops a close/reopen loop. */
function respeakMaxPerCall() {
  return positiveInt(process.env.VOICE_TTS_RESPEAK_MAX, 2);
}

/**
 * Soniox closes a socket that has been quiet for about 10 s (1001 Timeout).
 * beginSpeak opens a fresh socket first when the open one has been quiet
 * longer than this and no line is in flight.
 */
function idleRecycleMs() {
  return positiveInt(process.env.VOICE_TTS_IDLE_RECYCLE_MS, 8000);
}

/**
 * Error classes a re-speak can fix: the socket went away, or the provider
 * had a transient fault. Billing / auth / stale-stream errors are not these.
 * @param {{ billing?: boolean, fatal?: boolean, staleStream?: boolean, code?: number|null }} classified
 */
function isTransientTtsFault(classified) {
  if (!classified || classified.billing || classified.fatal || classified.staleStream) {
    return false;
  }
  const code = classified.code;
  return code == null || code === 408 || code === 429 || code >= 500;
}

/**
 * Persistent Soniox TTS connection. Each speak() uses a fresh stream_id.
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {string} [opts.voiceId] Tenant curated voice override
 * @param {(pcm: Buffer, meta: { streamId: string, audioEnd?: boolean, fallback?: string }) => void} [opts.onAudio]
 * @param {(evt: object) => void} [opts.onEvent]
 * @param {(text: string, meta: { language: string, speed: number|null, streamId: string }) => Promise<Buffer|{ pcm: Buffer|null, source?: string }|null>} [opts.fallbackPcm]
 *   Speaks a line Soniox lost when the re-speak cannot reconnect.
 * @param {() => boolean} [opts.shouldRespeak] false when the caller barged in or the call is over.
 */
function createSonioxTtsSession({
  callSid,
  voiceId,
  onAudio = () => {},
  onEvent = () => {},
  fallbackPcm = null,
  shouldRespeak = null,
}) {
  const apiKey = process.env.SONIOX_API_KEY;
  const voice = resolveSonioxVoice(voiceId);
  if (!apiKey) throw new Error('SONIOX_API_KEY is not configured');

  let closed = false;
  let ws = null;
  let connectPromise = null;
  let lastSocketActivityAt = 0;
  /** Session-level billing/auth failure. Further speak() must fail fast. */
  let providerDead = null;
  /** Re-speaks used on this call (VOICE_TTS_RESPEAK_MAX). */
  let respeaksUsed = 0;
  /**
   * In-flight lines keyed by the stable stream id the caller holds.
   * @type {Map<string, any>}
   */
  const active = new Map();
  /** Soniox wire stream id → stable stream id (differs after a re-speak). */
  const wireToStream = new Map();
  /** Wire ids of a line that was re-spoken. Their late audio is dropped. */
  const retiredWires = new Set();

  function noteActivity() {
    lastSocketActivityAt = Date.now();
  }

  function dropWaiter(waiter) {
    if (active.get(waiter.streamId) === waiter) active.delete(waiter.streamId);
    if (waiter.wireId) wireToStream.delete(waiter.wireId);
  }

  function settle(waiter, kind, value) {
    if (waiter.settled) return;
    waiter.settled = true;
    dropWaiter(waiter);
    if (kind === 'resolve') waiter.resolve(value);
    else waiter.reject(value);
  }

  function failSession(classified) {
    providerDead = classified;
    noteSonioxProviderError('tts', classified);
    const err = new Error(classified.message);
    err.code = classified.code;
    err.sonioxBilling = classified.billing;
    for (const waiter of [...active.values()]) {
      try {
        settle(waiter, 'reject', err);
      } catch {
        /* ignore */
      }
    }
    return err;
  }

  function closeSocketQuietly(socket) {
    try {
      if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    } catch {
      /* ignore */
    }
  }

  function ensureConnected() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(SONIOX_TTS_URL);
      ws = socket;
      const timer = setTimeout(() => {
        reject(new Error('Soniox TTS connect timeout'));
        if (ws === socket) connectPromise = null;
      }, 10000);
      timer.unref?.();

      socket.once('open', () => {
        clearTimeout(timer);
        noteActivity();
        const profile = resolveVoiceProfile();
        const model = resolveSonioxTtsModel();
        console.log(
          `[soniox-tts][${callSid}] session open model=${model} rate=${SAMPLE_RATE} voice=${voice}` +
            ` profile=${profile.name} speedEn=${profile.speedEn} speedSw=${profile.speedSw} gain=${profile.gain}`
        );
        resolve();
      });

      socket.once('error', (err) => {
        clearTimeout(timer);
        console.error(`[soniox-tts][${callSid}] ws error:`, err?.message || err);
        if (ws === socket) connectPromise = null;
        reject(err);
      });

      socket.on('message', (raw) => {
        noteActivity();
        try {
          const msg = JSON.parse(raw.toString());
          const wireId = msg.stream_id;
          if (wireId && retiredWires.has(wireId)) return;
          const streamKey = wireId ? wireToStream.get(wireId) || null : null;
          const waiter = streamKey ? active.get(streamKey) || null : null;

          if (msg.error_code != null || msg.error_type) {
            const classified = classifySonioxError(msg);
            onEvent({ type: 'error', raw: msg, classified });
            if (classified.billing || classified.fatal) {
              console.error(
                `[soniox-tts][${callSid}] error:`,
                msg.error_code || msg.error_type,
                msg.error_message || msg.message || ''
              );
              failSession(classified);
              return;
            }
            // Cancelled / unknown stream 400 must not mark the session dead.
            // Live miss HD_5de59f6babc7: barge-in cancel → 400 → mute for the rest of the call.
            if (classified.staleStream || !waiter) {
              console.warn(
                `[soniox-tts][${callSid}] ignoring stale stream error:`,
                msg.error_code || msg.error_type,
                msg.error_message || msg.message || ''
              );
              if (waiter) {
                try {
                  resolveWaiter(waiter, { cancelled: true, stale: true });
                } catch {
                  /* ignore */
                }
              }
              return;
            }
            console.error(
              `[soniox-tts][${callSid}] error:`,
              msg.error_code || msg.error_type,
              msg.error_message || msg.message || ''
            );
            const err = new Error(classified.message);
            err.code = classified.code;
            lineLost(waiter, err, {
              kind: 'error',
              code: classified.code,
              transient: isTransientTtsFault(classified),
            });
            return;
          }

          if (msg.audio) {
            noteSonioxProviderOk('tts');
            const pcm = Buffer.from(msg.audio, 'base64');
            if (pcm.length && waiter) {
              waiter.bytesReceived = (waiter.bytesReceived || 0) + pcm.length;
            }
            if (pcm.length && waiter?.chunks) waiter.chunks.push(pcm);
            if (msg.audio_end && waiter) waiter.audioEnd = true;
            if (pcm.length && !waiter?.silent) {
              onAudio(pcm, {
                streamId: waiter ? waiter.streamId : wireId,
                audioEnd: Boolean(msg.audio_end),
              });
            }
          } else if (msg.audio_end && waiter) {
            waiter.audioEnd = true;
          }

          if (msg.terminated) {
            if (waiter) {
              if (
                !waiter.cancelled &&
                !waiter.silent &&
                !(waiter.bytesReceived > 0)
              ) {
                const model = resolveSonioxTtsModel();
                console.error(
                  `[soniox-tts][${callSid}] silent stream=${waiter.streamId} model=${model} voice=${voice} — no PCM`
                );
                noteSonioxProviderError('tts', {
                  billing: false,
                  fatal: false,
                  code: 'tts_silent',
                  type: 'no_audio',
                  message: `TTS stream produced no PCM model=${model} voice=${voice}`,
                });
              }
              resolveWaiter(waiter, { cancelled: waiter.cancelled });
            }
            onEvent({ type: 'terminated', streamId: waiter ? waiter.streamId : wireId, raw: msg });
          }
        } catch (err) {
          console.warn(`[soniox-tts][${callSid}] bad message:`, err?.message || err);
        }
      });

      socket.on('close', (code, reason) => {
        const why = reason?.toString?.() || '';
        console.log(`[soniox-tts][${callSid}] closed code=${code} reason=${why}`);
        // A recycled or replaced socket must not null out the live one.
        if (ws === socket) {
          connectPromise = null;
          ws = null;
        }
        for (const waiter of [...active.values()]) {
          if (waiter.socket !== socket || waiter.recovering) continue;
          lineLost(waiter, new Error(`TTS socket closed (${code})`), {
            kind: 'close',
            code,
            reason: why,
            transient: true,
          });
        }
        onEvent({ type: 'close', text: String(code) });
      });
    });

    // A rejected connect with no awaiter must never become an unhandled rejection.
    connectPromise.catch(() => {});
    return connectPromise;
  }

  /**
   * A re-speak gave up on a slow connect. Drop that attempt so the next line
   * starts a fresh connect instead of waiting out the 10 s connect timeout.
   */
  function abandonPendingConnect() {
    if (!ws || ws.readyState === WebSocket.OPEN) return;
    const pending = ws;
    ws = null;
    connectPromise = null;
    try {
      pending.close();
    } catch {
      /* ignore */
    }
  }

  function withTimeout(promise, ms, label) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  function snapshotPcm(waiter) {
    if (!waiter?.chunks?.length) return null;
    return Buffer.concat(waiter.chunks);
  }

  function resolveWaiter(waiter, extra = {}) {
    settle(waiter, 'resolve', { pcm: snapshotPcm(waiter), ...extra });
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Soniox TTS socket not open');
    }
    ws.send(JSON.stringify(obj));
    noteActivity();
  }

  function lineText(waiter) {
    return waiter.pieces.join('').replace(/\s+/g, ' ').trim();
  }

  /**
   * One log line per lost-line event, at its outcome.
   */
  function logRespeak(waiter, evt, outcome, extra = '') {
    const ms = Date.now() - evt.at;
    console.warn(
      `[soniox-tts][${callSid}] respeak stream=${waiter.streamId} ${evt.kind}=${evt.code ?? ''}` +
        (evt.reason ? ` reason=${evt.reason}` : '') +
        ` pieces=${waiter.pieces.length} heard_bytes=${evt.bytesBefore}` +
        ` outcome=${outcome} used=${respeaksUsed}/${respeakMaxPerCall()} ms=${ms}` +
        (extra ? ` ${extra}` : '')
    );
    onEvent({
      type: 'respeak',
      streamId: waiter.streamId,
      cause: evt.kind,
      code: evt.code ?? null,
      reason: evt.reason || '',
      outcome,
      ms,
    });
  }

  /**
   * Soniox lost an in-flight line (socket close or stream error).
   * Off switch: reject exactly as before.
   */
  function lineLost(waiter, err, info) {
    // Already on the fallback chain: a later close is not a new event.
    if (waiter.settled || waiter.fallbackMode) return;
    if (waiter.wireId) {
      wireToStream.delete(waiter.wireId);
      retiredWires.add(waiter.wireId);
    }
    const evt = {
      at: Date.now(),
      kind: info.kind,
      code: info.code,
      reason: info.reason || '',
      bytesBefore: waiter.bytesReceived || 0,
    };
    err.ttsClose = info.kind === 'close' ? { code: info.code, reason: evt.reason } : null;
    err.transient = Boolean(info.transient);

    if (!isTtsRespeakEnabled()) {
      settle(waiter, 'reject', err);
      return;
    }
    // The whole line already reached the caller. Saying it again would double-speak.
    if (waiter.audioEnd) {
      logRespeak(waiter, evt, 'skipped_audio_complete');
      resolveWaiter(waiter, { cancelled: false, closedAfterAudio: true });
      return;
    }
    if (waiter.cancelled || closed || (shouldRespeak && !shouldRespeak())) {
      logRespeak(waiter, evt, closed ? 'skipped_call_ended' : 'skipped_barge');
      resolveWaiter(waiter, { cancelled: true });
      return;
    }
    // Nothing configured yet (prefetched reply stream): reconnect only.
    // That costs no re-speak (no line is repeated), but is capped per stream.
    const nothingSent = waiter.pieces.length === 0 && !waiter.ended;
    const canReconnect = nothingSent
      ? waiter.reconnects < 2
      : waiter.respeaks < 1 && respeaksUsed < respeakMaxPerCall();
    if (info.transient && canReconnect) {
      if (nothingSent) {
        waiter.reconnects += 1;
      } else {
        respeaksUsed += 1;
        waiter.respeaks += 1;
      }
      void respeak(waiter, err, evt, { nothingSent });
      return;
    }
    void fallBack(waiter, err, evt, info.transient ? 'budget' : 'not_transient');
  }

  async function respeak(waiter, err, evt, { nothingSent }) {
    waiter.recovering = true;
    try {
      await withTimeout(ensureConnected(), respeakConnectMs(), 'Soniox TTS reconnect timeout');
    } catch (connectErr) {
      waiter.recovering = false;
      abandonPendingConnect();
      return fallBack(waiter, err, evt, `reconnect_failed:${connectErr?.message || connectErr}`);
    }
    waiter.recovering = false;
    if (waiter.settled) return undefined;
    if (waiter.cancelled || closed || (shouldRespeak && !shouldRespeak())) {
      logRespeak(waiter, evt, closed ? 'skipped_call_ended' : 'skipped_barge');
      resolveWaiter(waiter, { cancelled: true });
      return undefined;
    }
    if (providerDead) {
      return fallBack(waiter, err, evt, 'provider_dead');
    }
    waiter.attempt += 1;
    waiter.wireId = `${waiter.streamId}-r${waiter.attempt}`;
    waiter.socket = ws;
    waiter.bytesReceived = 0;
    waiter.audioEnd = false;
    if (waiter.chunks) waiter.chunks = [];
    waiter.configSent = false;
    wireToStream.set(waiter.wireId, waiter.streamId);
    try {
      if (waiter.configured) sendConfig(waiter);
      for (const piece of waiter.pieces) {
        sendJson({ text: piece, text_end: false, stream_id: waiter.wireId });
      }
      if (waiter.ended && waiter.configured) {
        sendJson({ text: '', text_end: true, stream_id: waiter.wireId });
      }
    } catch (sendErr) {
      wireToStream.delete(waiter.wireId);
      retiredWires.add(waiter.wireId);
      return fallBack(waiter, err, evt, `resend_failed:${sendErr?.message || sendErr}`);
    }
    logRespeak(waiter, evt, nothingSent ? 'reconnected' : 'respoken');
    // An ended line with nothing to say resolves now (no Soniox stream to wait on).
    if (waiter.ended && !waiter.configured) {
      resolveWaiter(waiter, { cancelled: false, empty: true });
    }
    return undefined;
  }

  async function fallBack(waiter, err, evt, why) {
    if (waiter.settled) return;
    if (!fallbackPcm) {
      logRespeak(waiter, evt, 'lost_no_fallback', `why=${why}`);
      settle(waiter, 'reject', err);
      return;
    }
    waiter.fallbackMode = true;
    waiter.fallbackEvt = evt;
    waiter.fallbackWhy = why;
    waiter.fallbackErr = err;
    // A streamed reply is still being written: speak it once it is complete.
    if (!waiter.ended) return;
    await runFallback(waiter);
  }

  async function runFallback(waiter) {
    if (waiter.settled || waiter.fallbackRunning) return;
    waiter.fallbackRunning = true;
    const evt = waiter.fallbackEvt;
    const why = waiter.fallbackWhy;
    const text = lineText(waiter);
    if (!text) {
      logRespeak(waiter, evt, 'fallback_empty', `why=${why}`);
      resolveWaiter(waiter, { cancelled: false, empty: true });
      return;
    }
    let pcm = null;
    let source = 'fallback';
    try {
      const out = await fallbackPcm(text, {
        language: waiter.language || 'en',
        speed: waiter.speed,
        streamId: waiter.streamId,
      });
      if (Buffer.isBuffer(out)) pcm = out;
      else if (out && out.pcm) {
        pcm = out.pcm;
        source = out.source || source;
      }
    } catch (fbErr) {
      console.warn(`[soniox-tts][${callSid}] fallback failed:`, fbErr?.message || fbErr);
    }
    if (waiter.settled) return;
    if (waiter.cancelled || closed || (shouldRespeak && !shouldRespeak())) {
      logRespeak(waiter, evt, closed ? 'skipped_call_ended' : 'skipped_barge', `why=${why}`);
      resolveWaiter(waiter, { cancelled: true });
      return;
    }
    if (!pcm || !pcm.length) {
      logRespeak(waiter, evt, 'fallback_failed', `why=${why}`);
      settle(waiter, 'reject', waiter.fallbackErr);
      return;
    }
    if (!waiter.silent) onAudio(pcm, { streamId: waiter.streamId, audioEnd: true, fallback: source });
    logRespeak(waiter, evt, `fallback_${source}`, `why=${why} bytes=${pcm.length}`);
    // pcm stays null: fallback audio must never land in the Soniox
    // filler / greeting caches.
    settle(waiter, 'resolve', {
      pcm: null,
      cancelled: false,
      fallback: source,
    });
  }

  function sendConfig(waiter) {
    sendJson({
      api_key: apiKey,
      model: resolveSonioxTtsModel(),
      language: waiter.language,
      voice,
      speed: waiter.speed,
      audio_format: 'pcm_s16le',
      sample_rate: SAMPLE_RATE,
      stream_id: waiter.wireId,
    });
    waiter.configSent = true;
  }

  /**
   * A socket idle past Soniox's timeout is about to be closed under us.
   * Open a fresh one first when no line is in flight.
   */
  function recycleIdleSocket() {
    if (!isTtsRespeakEnabled()) return;
    if (!ws || ws.readyState !== WebSocket.OPEN || active.size > 0) return;
    const idleMs = Date.now() - lastSocketActivityAt;
    if (!lastSocketActivityAt || idleMs < idleRecycleMs()) return;
    const old = ws;
    ws = null;
    connectPromise = null;
    console.log(`[soniox-tts][${callSid}] recycle idle socket idle_ms=${idleMs}`);
    closeSocketQuietly(old);
  }

  /**
   * Open a Soniox TTS stream that accepts incremental text chunks (LLM→TTS).
   * @param {{ language?: string, callLanguage?: string, speed?: number, speedScale?: number, alreadyPrepared?: boolean, extraLexicon?: unknown, addressTerms?: unknown, capture?: boolean, silent?: boolean }} [opts]
   */
  async function beginSpeak(opts = {}) {
    if (closed) throw new Error('TTS session closed');
    if (providerDead) {
      const err = new Error(providerDead.message);
      err.code = providerDead.code;
      err.sonioxBilling = providerDead.billing;
      throw err;
    }
    recycleIdleSocket();
    await ensureConnected();
    if (providerDead) {
      const err = new Error(providerDead.message);
      err.code = providerDead.code;
      err.sonioxBilling = providerDead.billing;
      throw err;
    }

    const streamId = `tts-${randomUUID()}`;
    // Language may be refined on first push via prepareForTts.
    const presetLanguage =
      opts.language === 'sw' || opts.language === 'en'
        ? opts.language
        : null;
    const speedHint = opts.speed != null ? clampSpeed(opts.speed) : null;
    // Per-call caller-requested scale (slower/faster). 1 = profile default.
    const speedScale =
      Number.isFinite(opts.speedScale) && opts.speedScale > 0 ? opts.speedScale : 1;

    const waiter = {
      streamId,
      wireId: streamId,
      socket: ws,
      attempt: 0,
      respeaks: 0,
      reconnects: 0,
      cancelled: false,
      settled: false,
      recovering: false,
      fallbackMode: false,
      chunks: opts.capture ? [] : null,
      silent: Boolean(opts.silent),
      bytesReceived: 0,
      audioEnd: false,
      configured: false,
      configSent: false,
      ended: false,
      language: presetLanguage,
      speed: speedHint,
      /** Wire text of every piece pushed, for a re-speak from the start. */
      pieces: [],
    };
    const done = new Promise((resolve, reject) => {
      waiter.resolve = resolve;
      waiter.reject = reject;
      active.set(streamId, waiter);
      wireToStream.set(streamId, streamId);
    });
    // A prefetched stream nobody awaits yet must not crash the process when
    // the socket closes under it (13 Oct, HD_116ff6a67508). Awaiters still
    // see the rejection.
    done.catch(() => {});

    function ensureConfigured(resolvedLang) {
      if (waiter.configured) return;
      waiter.language = resolvedLang === 'sw' ? 'sw' : 'en';
      const baseSpeed = speedHint != null ? speedHint : speedForLanguage(waiter.language);
      waiter.speed = clampSpeed(baseSpeed * speedScale);
      waiter.configured = true;
      // Do not send the silence-reduction flag. Unsupported models 400,
      // and the default keeps natural pauses between words.
      if (!waiter.recovering && !waiter.fallbackMode) sendConfig(waiter);
      console.log(
        `[soniox-tts][${callSid}] begin stream=${streamId} lang=${waiter.language} speed=${waiter.speed}` +
          (speedScale !== 1 ? ` (scale=${speedScale})` : '')
      );
    }

    /**
     * Push one text chunk into the open stream.
     * @param {string} text
     */
    function pushText(text) {
      if (waiter.ended || closed) return { pushed: false };
      const prepared = opts.alreadyPrepared
        ? {
            original: String(text || ''),
            text: String(text || '').trim(),
            language:
              waiter.language || opts.language || process.env.SONIOX_TTS_LANGUAGE || 'en',
          }
        : prepareForTts(text, {
            callLanguage: opts.callLanguage,
            language: opts.language || waiter.language || undefined,
            extraLexicon: opts.extraLexicon,
            addressTerms: opts.addressTerms,
          });
      // No letterless piece, and a word gap between pieces of one stream
      // (src/speech/ttsBoundary.js).
      const wire = wireTextForPiece(prepared.text, { first: waiter.pieces.length === 0 });
      if (!wire) return { pushed: false, language: prepared.language };
      const clean = wire.trim();

      const respeakOn = isTtsRespeakEnabled();
      let recorded = false;
      try {
        ensureConfigured(prepared.language);
        waiter.pieces.push(wire);
        recorded = true;
        if (!waiter.recovering && !waiter.fallbackMode) {
          sendJson({ text: wire, text_end: false, stream_id: waiter.wireId });
        }
      } catch (err) {
        if (!respeakOn) throw err;
        // Socket dropped before its close event reached us: the piece is
        // recorded, so the re-speak / fallback covers it.
        if (!recorded) waiter.pieces.push(wire);
        lineLost(waiter, err, { kind: 'close', code: 'send', transient: true });
      }
      console.log(
        `[soniox-tts][${callSid}] chunk stream=${streamId} piece=${waiter.pieces.length} chars=${clean.length}` +
          ` original=${JSON.stringify(prepared.original)} spoken=${JSON.stringify(wire)}`
      );
      return { pushed: true, language: prepared.language, text: clean };
    }

    /**
     * Signal text_end and wait for Soniox terminated.
     */
    async function end() {
      if (waiter.ended) return done.catch(() => ({ cancelled: true }));
      waiter.ended = true;
      if (!waiter.configured) {
        // Nothing spoken — resolve without opening a Soniox stream.
        if (!waiter.settled) resolveWaiter(waiter, { cancelled: false, empty: true });
        return { cancelled: false, empty: true };
      }
      if (waiter.settled) return done;
      if (waiter.fallbackMode) {
        void runFallback(waiter);
        return done;
      }
      // A re-speak in progress sends text_end itself once it reconnects.
      if (waiter.recovering) return done;
      try {
        sendJson({ text: '', text_end: true, stream_id: waiter.wireId });
      } catch (err) {
        if (!isTtsRespeakEnabled()) {
          settle(waiter, 'reject', err);
          throw err;
        }
        lineLost(waiter, err, { kind: 'close', code: 'send', transient: true });
      }
      return done;
    }

    function cancel() {
      waiter.ended = true;
      if (!waiter.configured) {
        waiter.cancelled = true;
        if (!waiter.settled) resolveWaiter(waiter, { cancelled: true, empty: true });
        return;
      }
      cancelStream(streamId);
    }

    return {
      streamId,
      pushText,
      end,
      cancel,
      done,
      get language() {
        return waiter.language;
      },
    };
  }

  /**
   * Speak full text. Returns when stream terminates.
   * Runs prepareForTts unless opts.alreadyPrepared is set.
   * @param {string} text
   * @param {{ language?: string, callLanguage?: string, alreadyPrepared?: boolean, speed?: number, extraLexicon?: unknown }} [opts]
   */
  async function speak(text, opts = {}) {
    const session = await beginSpeak(opts);
    const pushed = session.pushText(text);
    if (!pushed.pushed) {
      session.cancel();
      return { cancelled: false, empty: true };
    }
    return session.end();
  }

  function cancelStream(streamId) {
    const targets = streamId ? [streamId] : [...active.keys()];
    for (const id of targets) {
      const waiter = active.get(id) || active.get(wireToStream.get(id));
      let wireId = id;
      // Resolve locally so speak()/end() does not stall waiting on a remote
      // `terminated` that may be slow or missing after cancel.
      if (waiter) {
        waiter.cancelled = true;
        wireId = waiter.wireId;
        const configSent = waiter.configSent;
        try {
          resolveWaiter(waiter, { cancelled: true });
        } catch {
          /* ignore */
        }
        if (!configSent) continue;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      try {
        sendJson({ stream_id: wireId, cancel: true });
      } catch (err) {
        console.warn(`[soniox-tts][${callSid}] cancel failed:`, err?.message || err);
      }
    }
  }

  function cancel(streamId) {
    cancelStream(streamId);
  }

  function close() {
    if (closed) return;
    closed = true;
    cancel();
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch {
      /* ignore */
    }
    ws = null;
    connectPromise = null;
  }

  const ready = ensureConnected();
  ready.catch(() => {});

  return {
    ready,
    beginSpeak,
    speak,
    cancel,
    close,
    SAMPLE_RATE,
    get respeaksUsed() {
      return respeaksUsed;
    },
  };
}

module.exports = {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
  isTtsRespeakEnabled,
  isTransientTtsFault,
  respeakConnectMs,
  respeakMaxPerCall,
  idleRecycleMs,
  speedForLanguage,
  SAMPLE_RATE,
  resolveSonioxTtsModel,
};
