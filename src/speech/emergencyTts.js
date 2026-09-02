// Last-resort spoken audio when Soniox TTS is down (billing 402, auth, etc.).
// Prefers local espeak-ng (Docker). Falls back to Gemini TTS when configured.
// Output: mono pcm_s16le @ 16 kHz for SautiKit /ws/media.

const { spawn } = require('child_process');
const { wavBytesTo16kPcm, resampleS16le, pcmDurationMs } = require('./pcmUtil');

const SAMPLE_RATE = 16000;

const OUTAGE_LINE_EN =
  'Sorry, I cannot take your call right now. Please try again shortly.';
const OUTAGE_LINE_SW =
  'Samahani, siwezi kupokea simu sasa. Tafadhali piga tena baadaye.';

function pickSpeechOutageLine(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return OUTAGE_LINE_SW;
  return OUTAGE_LINE_EN;
}

function espeakVoice(language) {
  const lang = String(language || 'en').toLowerCase();
  if (lang === 'sw' || lang === 'sheng') return 'sw';
  return 'en-gb';
}

function runEspeak(text, voice) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'espeak-ng',
      ['-v', voice, '-s', '145', '-a', '160', '--stdout', String(text)],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const chunks = [];
    const errChunks = [];
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      reject(new Error('espeak-ng timeout'));
    }, 8000);
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString().slice(0, 200);
        reject(new Error(`espeak-ng exited ${code} ${stderr}`.trim()));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}

async function synthesizeWithEspeak(text, language) {
  const primary = espeakVoice(language);
  const voices = primary === 'en-gb' ? ['en-gb', 'en'] : [primary, 'en-gb', 'en'];
  let lastErr = null;
  for (const voice of voices) {
    try {
      const wav = await runEspeak(text, voice);
      const pcm = wavBytesTo16kPcm(wav);
      if (pcm?.length) return pcm;
    } catch (err) {
      lastErr = err;
      if (err && err.code === 'ENOENT') break;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('espeak-ng produced no audio');
}

function extractGeminiInlineAudio(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const data = part?.inlineData?.data || part?.inline_data?.data;
    const mime = String(
      part?.inlineData?.mimeType || part?.inline_data?.mime_type || ''
    );
    if (data) return { data, mime };
  }
  return null;
}

function mimeSampleRate(mime) {
  const match = /rate=(\d+)/i.exec(String(mime || ''));
  if (match) return Number(match[1]);
  return 24000;
}

async function synthesizeWithGemini(text, language) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const { GoogleGenAI } = require('@google/genai');
  const model =
    process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
  const voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';
  const langCode = language === 'sw' || language === 'sheng' ? 'sw' : 'en';
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: String(text) }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
        languageCode: langCode === 'sw' ? 'sw-KE' : 'en-US',
      },
    },
  });
  const inline = extractGeminiInlineAudio(response);
  if (!inline?.data) throw new Error('Gemini TTS returned no audio');
  const raw = Buffer.from(inline.data, 'base64');
  const fromWav = wavBytesTo16kPcm(raw);
  if (fromWav !== raw) return fromWav;
  const fromRate = mimeSampleRate(inline.mime);
  if (fromRate && fromRate !== SAMPLE_RATE) {
    return resampleS16le(raw, fromRate, SAMPLE_RATE);
  }
  return fromWav;
}

/**
 * Synthesize emergency PCM. Returns null if every backend fails.
 * @param {string} text
 * @param {{ language?: string }} [opts]
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeEmergencyPcm(text, opts = {}) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  const language = opts.language || 'en';

  try {
    const pcm = await synthesizeWithEspeak(clean, language);
    if (pcm?.length) {
      console.warn(
        `[emergency-tts] espeak-ng chars=${clean.length} bytes=${pcm.length} lang=${language}`
      );
      return pcm;
    }
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn(`[emergency-tts] espeak-ng failed:`, err?.message || err);
    }
  }

  try {
    const pcm = await synthesizeWithGemini(clean, language);
    if (pcm?.length) {
      console.warn(
        `[emergency-tts] gemini chars=${clean.length} bytes=${pcm.length} lang=${language}`
      );
      return pcm;
    }
  } catch (err) {
    console.warn(`[emergency-tts] gemini failed:`, err?.message || err);
  }

  return null;
}

module.exports = {
  SAMPLE_RATE,
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  pickSpeechOutageLine,
  synthesizeEmergencyPcm,
  synthesizeWithEspeak,
  synthesizeWithGemini,
  pcmDurationMs,
};
