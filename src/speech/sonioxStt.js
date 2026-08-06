// src/speech/sonioxStt.js
// Soniox realtime STT over WebSocket. Feeds pcm_s16le @ 16 kHz from SautiKit.

const WebSocket = require('ws');

const SONIOX_WS_URL =
  process.env.SONIOX_STT_URL || 'wss://stt-rt.soniox.com/transcribe-websocket';
const SONIOX_MODEL = process.env.SONIOX_STT_MODEL || 'stt-rt-v5';
const SAMPLE_RATE = Number(process.env.SONIOX_SAMPLE_RATE || 16000);

/**
 * Open a Soniox realtime transcription session.
 * @param {object} opts
 * @param {string} opts.callSid
 * @param {(evt: { type: string, text?: string, isFinal?: boolean, raw?: object }) => void} [opts.onEvent]
 * @returns {{ sendAudio: (buf: Buffer) => void, close: () => void, ready: Promise<void> }}
 */
function createSonioxSttSession({ callSid, onEvent = () => {} }) {
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
      const config = {
        api_key: apiKey,
        model: SONIOX_MODEL,
        audio_format: 'pcm_s16le',
        sample_rate: SAMPLE_RATE,
        num_channels: 1,
        language_hints: ['en', 'sw'],
        // Faster turn-taking (stt-rt-v5 endpoint detection tuning).
        enable_endpoint_detection: true,
        endpoint_latency_adjustment_level: 2,
        max_endpoint_delay_ms: 800,
        endpoint_sensitivity: 0.5,
      };
      ws.send(JSON.stringify(config));
      opened = true;
      console.log(
        `[soniox-stt][${callSid}] session open model=${SONIOX_MODEL} rate=${SAMPLE_RATE} endpoint={latencyAdj:2,maxDelayMs:800,sensitivity:0.5}`
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
        // Buffer a little audio while the STT socket connects.
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
  SAMPLE_RATE,
};
