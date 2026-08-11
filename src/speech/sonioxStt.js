// src/speech/sonioxStt.js
// Soniox realtime STT over WebSocket. Feeds pcm_s16le @ 16 kHz from SautiKit.

const WebSocket = require('ws');
const { sttLanguageHints } = require('../conversation/languageOptions');
const { buildSttContext, isSttContextEnabled } = require('./sttContext');

const SONIOX_WS_URL =
  process.env.SONIOX_STT_URL || 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = process.env.SONIOX_STT_MODEL || 'stt-rt-v5';
const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);
/** Default ceiling for Soniox endpoint detection (local flush adapts under this). */
const MAX_ENDPOINT_DELAY_MS = Number(process.env.SONIOX_MAX_ENDPOINT_DELAY_MS || 700);
const ENDPOINT_SENSITIVITY = Math.min(
  1,
  Math.max(0, Number(process.env.SONIOX_ENDPOINT_SENSITIVITY || 0.5))
);
const ENDPOINT_LATENCY_ADJ = Number(process.env.SONIOX_ENDPOINT_LATENCY_ADJ || 2);
/** Max wait for tenant profile before opening STT without context. */
const CONTEXT_WAIT_MS = Number(process.env.SONIOX_STT_CONTEXT_WAIT_MS || 800);

/**
 * Resolve optional context / contextPromise with a short timeout so early audio
 * is not blocked if tenant load is slow.
 * @param {{ context?: object|null, contextPromise?: Promise<object|null>|null }} opts
 */
async function resolveSessionContext(opts = {}) {
  if (!isSttContextEnabled()) return null;
  if (opts.context && typeof opts.context === 'object') return opts.context;
  if (!opts.contextPromise) return null;
  try {
    return await Promise.race([
      Promise.resolve(opts.contextPromise).catch(() => null),
      new Promise((resolve) => setTimeout(() => resolve(null), CONTEXT_WAIT_MS)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Open a Soniox realtime transcription session.
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {(evt: { type: string, text?: string, isFinal?: boolean, raw?: object }) => void} [opts.onEvent]
 * @param {{ general?: Array<{key:string,value:string}>, terms?: string[] }|null} [opts.context]
 * @param {Promise<{ general?: Array<{key:string,value:string}>, terms?: string[] }|null>} [opts.contextPromise]
 * @returns {{ sendAudio: (buf: Buffer) => void, close: () => void, ready: Promise<void> }}
 */
function createSonioxSttSession({ callSid, onEvent = () => {}, context = null, contextPromise = null }) {
  const apiKey = process.env.SONIOX_API_KEY;
  if (!apiKey) {
    throw new Error('SONIOX_API_KEY is not configured');
  }

  let closed = false;
  let opened = false;
  const pending = [];

  const ws = new WebSocket(SONIOX_WS_URL);

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Soniox STT connect timeout'));
    }, 10000);

    ws.once('open', () => {
      clearTimeout(timer);
      (async () => {
        const hints = sttLanguageHints();
        const resolved = await resolveSessionContext({ context, contextPromise });
        const config = {
          api_key: apiKey,
          model: SONIOX_MODEL,
          audio_format: 'pcm_s16le',
          sample_rate: SAMPLE_RATE,
          num_channels: 1,
          language_hints: hints,
          // Endpoint tuning: snappier defaults; incomplete thoughts rely on adaptive local flush.
          enable_endpoint_detection: true,
          endpoint_latency_adjustment_level: ENDPOINT_LATENCY_ADJ,
          max_endpoint_delay_ms: MAX_ENDPOINT_DELAY_MS,
          endpoint_sensitivity: ENDPOINT_SENSITIVITY,
        };

        const contextUsed = Boolean(
          resolved &&
            ((Array.isArray(resolved.terms) && resolved.terms.length) ||
              (Array.isArray(resolved.general) && resolved.general.length))
        );
        if (contextUsed) {
          config.context = {
            general: Array.isArray(resolved.general) ? resolved.general : [],
            terms: Array.isArray(resolved.terms) ? resolved.terms : [],
          };
        }

        ws.send(JSON.stringify(config));
        opened = true;

        const termList = contextUsed ? config.context.terms : [];
        console.log(
          `[soniox-stt][${callSid}] session open model=${SONIOX_MODEL} rate=${SAMPLE_RATE}` +
            ` hints=${hints.join('+')}` +
            ` context_used=${contextUsed}` +
            ` terms=${termList.length}` +
            (termList.length ? ` term_list=${JSON.stringify(termList)}` : '') +
            ` endpoint={latencyAdj:${ENDPOINT_LATENCY_ADJ},maxDelayMs:${config.max_endpoint_delay_ms},sensitivity:${ENDPOINT_SENSITIVITY}}`
        );

        while (pending.length) {
          const chunk = pending.shift();
          try {
            ws.send(chunk);
          } catch (err) {
            console.warn(`[soniox-stt][${callSid}] flush error:`, err?.message || err);
          }
        }
        resolve();
      })().catch((err) => {
        console.error(`[soniox-stt][${callSid}] open config failed:`, err?.message || err);
        reject(err);
      });
    });

    ws.once('error', (err) => {
      clearTimeout(timer);
      console.error(`[soniox-stt][${callSid}] ws error:`, err?.message || err);
      reject(err);
    });
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.error_code || msg.error_type) {
        console.error(
          `[soniox-stt][${callSid}] error:`,
          msg.error_code || msg.error_type,
          msg.message || msg.error_message || ''
        );
        onEvent({ type: 'error', raw: msg });
        return;
      }

      if (Array.isArray(msg.tokens) && msg.tokens.length) {
        let interim = '';
        let finals = '';
        let sawEndpoint = false;
        for (const token of msg.tokens) {
          if (!token || typeof token.text !== 'string') continue;
          // Soniox endpoint marker when enable_endpoint_detection is on.
          if (token.text.includes('<end>')) {
            sawEndpoint = true;
            const cleaned = token.text.replace(/<\/?end>/g, '').replace(/\?/g, '').trim();
            if (cleaned) {
              if (token.is_final) finals += cleaned;
              else interim += cleaned;
            }
            continue;
          }
          if (token.is_final) finals += token.text;
          else interim += token.text;
        }
        if (finals) {
          console.log(`[soniox-stt][${callSid}] FINAL: ${finals}`);
          onEvent({ type: 'transcript', text: finals, isFinal: true, raw: msg });
        } else if (interim) {
          console.log(`[soniox-stt][${callSid}] interim: ${interim}`);
          onEvent({ type: 'transcript', text: interim, isFinal: false, raw: msg });
        }
        if (sawEndpoint) {
          console.log(`[soniox-stt][${callSid}] endpoint`);
          onEvent({ type: 'endpoint', raw: msg });
        }
      }

      if (msg.finished) {
        console.log(`[soniox-stt][${callSid}] finished`);
        onEvent({ type: 'finished', raw: msg });
      }
    } catch (err) {
      console.warn(`[soniox-stt][${callSid}] bad message:`, err?.message || err);
    }
  });

  ws.on('close', (code, reason) => {
    closed = true;
    console.log(
      `[soniox-stt][${callSid}] closed code=${code} reason=${reason?.toString?.() || ''}`
    );
    onEvent({ type: 'close', text: String(code) });
  });

  return {
    ready,
    sendAudio(buf) {
      if (closed || !buf || !buf.length) return;
      if (!opened || ws.readyState !== WebSocket.OPEN) {
        // Buffer a little audio while the STT socket connects / context resolves.
        if (pending.length < 200) pending.push(buf);
        return;
      }
      try {
        ws.send(buf);
      } catch (err) {
        console.warn(`[soniox-stt][${callSid}] send error:`, err?.message || err);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          // Empty frame signals end-of-audio to Soniox.
          ws.send(Buffer.alloc(0));
        }
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

function isSonioxConfigured() {
  return Boolean(process.env.SONIOX_API_KEY);
}

module.exports = {
  createSonioxSttSession,
  isSonioxConfigured,
  buildSttContext,
  isSttContextEnabled,
  SAMPLE_RATE,
};
