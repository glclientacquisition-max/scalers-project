// Last-resort spoken audio when Soniox TTS is down (billing 402, auth, etc.).
// Prefers a recording of the cloned receptionist voice, then espeak-ng.
// Gemini TTS is only for non-billing failures. A 402 must not wait on it.
// Output: mono pcm_s16le @ 16 kHz for SautiKit /ws/media.

const { spawn } = require('child_process');
const { wavBytesTo16kPcm, resampleS16le, pcmDurationMs } = require('./pcmUtil');
const {
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  pickSpeechOutageLine,
} = require('./outageCopy');
const { loadOutageClip } = require('./outageClips');

const SAMPLE_RATE = 16000;
/** Hang up this soon when neither a clip nor espeak produced PCM. */
const SILENT_OUTAGE_HANGUP_MS = 800;

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
 * Synthesize emergency PCM. Returns null if every allowed backend fails.
 * Order: packaged/memory/tmp clip, then espeak. Gemini runs only when
 * `skipGemini` is false (Soniox billing must pass skipGemini: true).
 * @param {string} text
 * @param {{ language?: string, voiceId?: string, skipGemini?: boolean, synthesizeEspeak?: Function, synthesizeGemini?: Function }} [opts]
 * @returns {Promise<Buffer|null>}
 */
async function synthesizeEmergencyPcm(text, opts = {}) {
  const language = opts.language || 'en';
  const clip = loadOutageClip(language, { voiceId: opts.voiceId });
  if (clip?.pcm?.length) {
    console.warn(
      `[emergency-tts] clone-voice clip source=${clip.source} lang=${clip.language} bytes=${clip.pcm.length}`
    );
    return clip.pcm;
  }

  const clean = String(text || pickSpeechOutageLine(language))
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;

  const espeak = opts.synthesizeEspeak || synthesizeWithEspeak;
  try {
    const pcm = await espeak(clean, language);
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

  if (opts.skipGemini) {
    console.warn('[emergency-tts] skip gemini (soniox billing)');
    return null;
  }

  const gemini = opts.synthesizeGemini || synthesizeWithGemini;
  try {
    const pcm = await gemini(clean, language);
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

/**
 * Billing/fatal speech-down plan. Speak when a clip or espeak returns PCM.
 * The 800ms hangup is only for the case where both produced nothing.
 * @param {{ language?: string, voiceId?: string, skipGemini?: boolean, synthesizeEspeak?: Function, synthesizeGemini?: Function }} [opts]
 */
async function planSpeechOutagePlayback(opts = {}) {
  const language = opts.language || 'en';
  const line = pickSpeechOutageLine(language);
  const pcm = await synthesizeEmergencyPcm(line, {
    language,
    voiceId: opts.voiceId,
    skipGemini: Boolean(opts.skipGemini),
    synthesizeEspeak: opts.synthesizeEspeak,
    synthesizeGemini: opts.synthesizeGemini,
  });
  if (pcm?.length) {
    return {
      speak: true,
      pcm,
      line,
      hangupMs: pcmDurationMs(pcm, SAMPLE_RATE) + 200,
    };
  }
  return {
    speak: false,
    pcm: null,
    line,
    hangupMs: SILENT_OUTAGE_HANGUP_MS,
  };
}

module.exports = {
  SAMPLE_RATE,
  SILENT_OUTAGE_HANGUP_MS,
  OUTAGE_LINE_EN,
  OUTAGE_LINE_SW,
  pickSpeechOutageLine,
  synthesizeEmergencyPcm,
  planSpeechOutagePlayback,
  synthesizeWithEspeak,
  synthesizeWithGemini,
  pcmDurationMs,
};
