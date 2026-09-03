// Clone-voice downtime recordings for when live Soniox TTS is down.
// Load order: in-memory (warmed from Soniox) → /tmp → packaged WAV in src/speech/pcm/.

const fs = require('fs');
const path = require('path');
const { pcmToWav } = require('./wavPack');
const { wavBytesTo16kPcm } = require('./pcmUtil');
const { outageClipLang, pickSpeechOutageLine } = require('./outageCopy');

const SAMPLE_RATE = 16000;

function packagedDir() {
  return process.env.VOICE_OUTAGE_CLIP_DIR || path.join(__dirname, 'pcm');
}

function tmpDir() {
  return process.env.VOICE_OUTAGE_TMP_DIR || '/tmp';
}

/** @type {{ en: Buffer|null, sw: Buffer|null }} */
const memory = { en: null, sw: null };
let warming = null;
let lastWarmAt = 0;

function packagedPath(lang) {
  return path.join(packagedDir(), `downtime-${lang}.wav`);
}

function tmpPath(lang) {
  return path.join(tmpDir(), `scalers-outage-downtime-${lang}.wav`);
}

function readWavPcm(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const wav = fs.readFileSync(filePath);
    const pcm = wavBytesTo16kPcm(wav);
    return pcm?.length ? pcm : null;
  } catch {
    return null;
  }
}

function writeTmpWav(lang, pcm) {
  try {
    fs.writeFileSync(tmpPath(lang), pcmToWav(pcm, SAMPLE_RATE));
  } catch (err) {
    console.warn(`[outage-clip] tmp write failed lang=${lang}:`, err?.message || err);
  }
}

function cacheClip(lang, pcm, source) {
  if (!pcm?.length) return null;
  const key = lang === 'sw' ? 'sw' : 'en';
  memory[key] = pcm;
  writeTmpWav(key, pcm);
  return { pcm, source, language: key };
}

function loadOutageClip(language) {
  const preferred = outageClipLang(language);
  const order = preferred === 'sw' ? ['sw', 'en'] : ['en'];
  for (const lang of order) {
    if (memory[lang]?.length) {
      return { pcm: memory[lang], source: 'memory', language: lang };
    }
    const tmp = readWavPcm(tmpPath(lang));
    if (tmp) {
      memory[lang] = tmp;
      return { pcm: tmp, source: 'tmp', language: lang };
    }
    const packaged = readWavPcm(packagedPath(lang));
    if (packaged) {
      memory[lang] = packaged;
      return { pcm: packaged, source: 'packaged', language: lang };
    }
  }
  return null;
}

/**
 * Render downtime lines with live Soniox (cloned receptionist voice) and cache them.
 * Safe to call while 402: it logs and returns. First successful TTS should call this.
 */
async function warmOutageClips(opts = {}) {
  if (warming) return warming;
  warming = (async () => {
    const { isSonioxTtsConfigured } = require('./sonioxTts');
    if (!isSonioxTtsConfigured()) {
      return { ok: false, reason: 'soniox_unconfigured' };
    }
    const { synthesizeTtsPreview } = require('./ttsPreview');
    const langs = opts.languages || ['en', 'sw'];
    const warmed = [];
    for (const lang of langs) {
      if (memory[lang]?.length) {
        warmed.push(lang);
        continue;
      }
      const packaged = readWavPcm(packagedPath(lang));
      if (packaged) {
        cacheClip(lang, packaged, 'packaged');
        warmed.push(lang);
        continue;
      }
      try {
        const result = await synthesizeTtsPreview({
          text: pickSpeechOutageLine(lang),
          language: lang,
          callLanguage: lang,
        });
        const pcm = wavBytesTo16kPcm(result.wav);
        if (pcm?.length) {
          cacheClip(lang, pcm, 'soniox');
          warmed.push(lang);
          console.log(
            `[outage-clip] warmed clone-voice downtime clip lang=${lang} bytes=${pcm.length}`
          );
        }
      } catch (err) {
        console.warn(
          `[outage-clip] warm failed lang=${lang}:`,
          err?.message || err
        );
      }
    }
    return { ok: warmed.length > 0, warmed };
  })();
  try {
    return await warming;
  } finally {
    warming = null;
  }
}

function scheduleOutageClipWarm() {
  if (memory.en && memory.sw) return;
  const now = Date.now();
  if (now - lastWarmAt < 60_000) return;
  lastWarmAt = now;
  warmOutageClips().catch((err) => {
    console.warn(`[outage-clip] scheduled warm failed:`, err?.message || err);
  });
}

/** Tests only. */
function resetOutageClipCache() {
  memory.en = null;
  memory.sw = null;
  warming = null;
  lastWarmAt = 0;
}

module.exports = {
  loadOutageClip,
  cacheClip,
  warmOutageClips,
  scheduleOutageClipWarm,
  resetOutageClipCache,
  packagedPath,
  tmpPath,
};
