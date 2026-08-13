// src/speech/sonioxTts.js
// Soniox realtime TTS over WebSocket. Emits pcm_s16le chunks for SautiKit.

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const { prepareForTts } = require('./ttsNormalize');
const { resolveSonioxVoice } = require('./sonioxVoice');

const SONIOX_TTS_URL =
  process.env.SONIOX_TTS_URL || 'wss://tts-rt.soniox.com/tts-websocket';
const SONIOX_TTS_MODEL = process.env.SONIOX_TTS_MODEL || 'tts-rt-v1';
const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);
function clampSpeed(n) {
  return Math.min(1.3, Math.max(0.7, Number(n)));
}

/** Modest bump over 1.0 — snappier than 0.95, without rushing Kenya EN calls. */
const TTS_SPEED = clampSpeed(process.env.SONIOX_TTS_SPEED || 1.02);

/** Optional slower Swahili pacing (falls back to SONIOX_TTS_SPEED). */
function speedForLanguage(lang) {
  if (lang === 'sw' && process.env.SONIOX_TTS_SPEED_SW) {
    return clampSpeed(process.env.SONIOX_TTS_SPEED_SW);
  }
  if (lang === 'en' && process.env.SONIOX_TTS_SPEED_EN) {
    return clampSpeed(process.env.SONIOX_TTS_SPEED_EN);
  }
  return TTS_SPEED;
}

function isSonioxTtsConfigured() {
  return Boolean(process.env.SONIOX_API_KEY);
}

/**
 * Persistent Soniox TTS connection. Each speak() uses a fresh stream_id.
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {string} [opts.voiceId] Tenant curated voice override
 * @param {(pcm: Buffer, meta: { streamId: string, audioEnd?: boolean }) => void} [opts.onAudio]
 * @param {(evt: object) => void} [opts.onEvent]
 */
function createSonioxTtsSession({
  callSid,
  voiceId,
  onAudio = () => {},
  onEvent = () => {},
}) {
  const apiKey = process.env.SONIOX_API_KEY;
  const voice = resolveSonioxVoice(voiceId);
  if (!apiKey) throw new Error('SONIOX_API_KEY is not configured');

  let closed = false;
  let ws = null;
  let connectPromise = null;
  /** @type {Map<string, { resolve: Function, reject: Function, cancelled: boolean }>} */
  const active = new Map();

  function ensureConnected() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }
    if (connectPromise) return connectPromise;

    connectPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Soniox TTS connect timeout'));
        connectPromise = null;
      }, 10000);

      const socket = new WebSocket(SONIOX_TTS_URL);
      ws = socket;

      socket.once('open', () => {
        clearTimeout(timer);
        console.log(
          `[soniox-tts][${callSid}] session open model=${SONIOX_TTS_MODEL} rate=${SAMPLE_RATE} voice=${voice}`
        );
        resolve();
      });

      socket.once('error', (err) => {
        clearTimeout(timer);
        console.error(`[soniox-tts][${callSid}] ws error:`, err?.message || err);
        connectPromise = null;
        reject(err);
      });

      socket.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const streamId = msg.stream_id;

          if (msg.error_code != null || msg.error_type) {
            console.error(
              `[soniox-tts][${callSid}] error:`,
              msg.error_code || msg.error_type,
              msg.error_message || msg.message || ''
            );
            onEvent({ type: 'error', raw: msg });
            const waiter = streamId ? active.get(streamId) : null;
            if (waiter) {
              active.delete(streamId);
              waiter.reject(
                new Error(msg.error_message || msg.message || `TTS error ${msg.error_code}`)
              );
            }
            return;
          }

          if (msg.audio) {
            const pcm = Buffer.from(msg.audio, 'base64');
            if (pcm.length) {
              onAudio(pcm, { streamId, audioEnd: Boolean(msg.audio_end) });
            }
          }

          if (msg.terminated) {
            const waiter = streamId ? active.get(streamId) : null;
            if (waiter) {
              active.delete(streamId);
              waiter.resolve({ cancelled: waiter.cancelled });
            }
            onEvent({ type: 'terminated', streamId, raw: msg });
          }
        } catch (err) {
          console.warn(`[soniox-tts][${callSid}] bad message:`, err?.message || err);
        }
      });

      socket.on('close', (code, reason) => {
        console.log(
          `[soniox-tts][${callSid}] closed code=${code} reason=${reason?.toString?.() || ''}`
        );
        connectPromise = null;
        ws = null;
        for (const [id, waiter] of active) {
          active.delete(id);
          waiter.reject(new Error(`TTS socket closed (${code})`));
        }
        onEvent({ type: 'close', text: String(code) });
      });
    });

    return connectPromise;
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Soniox TTS socket not open');
    }
    ws.send(JSON.stringify(obj));
  }

  /**
   * Open a Soniox TTS stream that accepts incremental text chunks (LLM→TTS).
   * @param {{ language?: string, callLanguage?: string, speed?: number, alreadyPrepared?: boolean, extraLexicon?: unknown }} [opts]
   */
  async function beginSpeak(opts = {}) {
    if (closed) throw new Error('TTS session closed');
    await ensureConnected();

    const streamId = `tts-${randomUUID()}`;
    // Language may be refined on first push via prepareForTts.
    let language =
      opts.language === 'sw' || opts.language === 'en'
        ? opts.language
        : null;
    const speedHint = opts.speed != null ? clampSpeed(opts.speed) : null;
    let speed = speedHint;
    let configured = false;
    let ended = false;

    const done = new Promise((resolve, reject) => {
      active.set(streamId, { resolve, reject, cancelled: false });
    });

    function ensureConfigured(resolvedLang) {
      if (configured) return;
      language = resolvedLang === 'sw' ? 'sw' : 'en';
      speed = speedHint != null ? speedHint : speedForLanguage(language);
      sendJson({
        api_key: apiKey,
        model: SONIOX_TTS_MODEL,
        language,
        voice,
        speed,
        audio_format: 'pcm_s16le',
        sample_rate: SAMPLE_RATE,
        stream_id: streamId,
      });
      configured = true;
      console.log(
        `[soniox-tts][${callSid}] begin stream=${streamId} lang=${language} speed=${speed}`
      );
    }

    /**
     * Push one text chunk into the open stream.
     * @param {string} text
     */
    function pushText(text) {
      if (ended || closed) return { pushed: false };
      const prepared = opts.alreadyPrepared
        ? {
            original: String(text || ''),
            text: String(text || '').trim(),
            language: language || opts.language || process.env.SONIOX_TTS_LANGUAGE || 'en',
          }
        : prepareForTts(text, {
            callLanguage: opts.callLanguage,
            language: opts.language || language || undefined,
            extraLexicon: opts.extraLexicon,
          });
      const clean = prepared.text;
      if (!clean) return { pushed: false, language: prepared.language };

      ensureConfigured(prepared.language);
      sendJson({ text: clean, text_end: false, stream_id: streamId });
      console.log(
        `[soniox-tts][${callSid}] chunk stream=${streamId} chars=${clean.length}` +
          ` original=${JSON.stringify(prepared.original)} spoken=${JSON.stringify(clean)}`
      );
      return { pushed: true, language: prepared.language, text: clean };
    }

    /**
     * Signal text_end and wait for Soniox terminated.
     */
    async function end() {
      if (ended) return done.catch(() => ({ cancelled: true }));
      ended = true;
      if (!configured) {
        // Nothing spoken — resolve without opening a Soniox stream.
        const waiter = active.get(streamId);
        if (waiter) {
          active.delete(streamId);
          waiter.resolve({ cancelled: false, empty: true });
        }
        return { cancelled: false, empty: true };
      }
      try {
        sendJson({ text: '', text_end: true, stream_id: streamId });
      } catch (err) {
        const waiter = active.get(streamId);
        if (waiter) {
          active.delete(streamId);
          waiter.reject(err);
        }
        throw err;
      }
      return done;
    }

    function cancel() {
      ended = true;
      if (!configured) {
        const waiter = active.get(streamId);
        if (waiter) {
          active.delete(streamId);
          waiter.resolve({ cancelled: true, empty: true });
        }
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
        return language;
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
      const waiter = active.get(id);
      // Resolve locally so speak()/end() does not stall waiting on a remote
      // `terminated` that may be slow or missing after cancel.
      if (waiter) {
        waiter.cancelled = true;
        active.delete(id);
        try {
          waiter.resolve({ cancelled: true });
        } catch {
          /* ignore */
        }
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      try {
        sendJson({ stream_id: id, cancel: true });
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

  return {
    ready: ensureConnected(),
    beginSpeak,
    speak,
    cancel,
    close,
    SAMPLE_RATE,
  };
}

module.exports = {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
  speedForLanguage,
  SAMPLE_RATE,
};
