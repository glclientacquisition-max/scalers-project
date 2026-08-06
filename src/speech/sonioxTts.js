// src/speech/sonioxTts.js
// Soniox realtime TTS over WebSocket. Emits pcm_s16le chunks for SautiKit.

const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const SONIOX_TTS_URL =
  process.env.SONIOX_TTS_URL || 'wss://tts-rt.soniox.com/tts-websocket';
const SONIOX_TTS_MODEL = process.env.SONIOX_TTS_MODEL || 'tts-rt-v1';
const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);

function isSonioxTtsConfigured() {
  return Boolean(process.env.SONIOX_API_KEY && process.env.SONIOX_VOICE);
}

/**
 * Persistent Soniox TTS connection. Each speak() uses a fresh stream_id.
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {(pcm: Buffer, meta: { streamId: string, audioEnd?: boolean }) => void} [opts.onAudio]
 * @param {(evt: object) => void} [opts.onEvent]
 */
function createSonioxTtsSession({ callSid, onAudio = () => {}, onEvent = () => {} }) {
  const apiKey = process.env.SONIOX_API_KEY;
  const voice = process.env.SONIOX_VOICE;
  if (!apiKey) throw new Error('SONIOX_API_KEY is not configured');
  if (!voice) throw new Error('SONIOX_VOICE is not configured');

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
   * Speak full text (non-streaming LLM for now). Returns when stream terminates.
   * @param {string} text
   * @param {{ language?: string }} [opts]
   */
  async function speak(text, opts = {}) {
    const clean = String(text || '').trim();
    if (!clean) return { cancelled: false };
    if (closed) throw new Error('TTS session closed');

    await ensureConnected();

    const streamId = `tts-${randomUUID()}`;
    const language = opts.language || process.env.SONIOX_TTS_LANGUAGE || 'en';

    const done = new Promise((resolve, reject) => {
      active.set(streamId, { resolve, reject, cancelled: false });
    });

    sendJson({
      api_key: apiKey,
      model: SONIOX_TTS_MODEL,
      language,
      voice,
      audio_format: 'pcm_s16le',
      sample_rate: SAMPLE_RATE,
      stream_id: streamId,
    });
    sendJson({ text: clean, text_end: false, stream_id: streamId });
    sendJson({ text: '', text_end: true, stream_id: streamId });

    console.log(
      `[soniox-tts][${callSid}] speak stream=${streamId} lang=${language} chars=${clean.length}`
    );

    return done;
  }

  function cancel(streamId) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const targets = streamId ? [streamId] : [...active.keys()];
    for (const id of targets) {
      const waiter = active.get(id);
      if (waiter) waiter.cancelled = true;
      try {
        sendJson({ stream_id: id, cancel: true });
      } catch (err) {
        console.warn(`[soniox-tts][${callSid}] cancel failed:`, err?.message || err);
      }
    }
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
    speak,
    cancel,
    close,
    SAMPLE_RATE,
  };
}

module.exports = {
  createSonioxTtsSession,
  isSonioxTtsConfigured,
  SAMPLE_RATE,
};
