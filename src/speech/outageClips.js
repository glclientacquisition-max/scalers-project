// Clone-voice downtime recordings keyed by catalog voice × language.
// Shared voices serve many tenants. Do not bake agent or business names into clips.
// Load order per voice: memory → /tmp → packaged default WAV.

const fs = require('fs');
const path = require('path');
const { pcmToWav } = require('./wavPack');
const { wavBytesTo16kPcm } = require('./pcmUtil');
const { outageClipLang, pickSpeechOutageLine } = require('./outageCopy');
const {
  getDefaultVoiceId,
  resolveCuratedVoiceId,
} = require('./sonioxVoiceCatalog');

const SAMPLE_RATE = 16000;

/** @type {Record<string, { en: Buffer|null, sw: Buffer|null }>} */
const memory = {};
/** @type {Map<string, Promise<object>>} */
const warmingByVoice = new Map();
/** @type {Record<string, number>} */
const lastWarmAt = {};

function packagedDir() {
  return process.env.VOICE_OUTAGE_CLIP_DIR || path.join(__dirname, 'pcm');
}

function tmpDir() {
  return process.env.VOICE_OUTAGE_TMP_DIR || '/tmp';
}

function voiceKey(voiceId) {
  return resolveCuratedVoiceId(voiceId);
}

function isDefaultVoice(voiceId) {
  return voiceKey(voiceId) === getDefaultVoiceId();
}

function slot(voiceId) {
  const id = voiceKey(voiceId);
  if (!memory[id]) memory[id] = { en: null, sw: null };
  return { id, langs: memory[id] };
}

function packagedPath(lang) {
  return path.join(packagedDir(), `downtime-${lang}.wav`);
}

function tmpPath(lang, voiceId) {
  const key = lang === 'sw' ? 'sw' : 'en';
  if (isDefaultVoice(voiceId)) {
    return path.join(tmpDir(), `scalers-outage-downtime-${key}.wav`);
  }
  return path.join(
    tmpDir(),
    `scalers-outage-downtime-${voiceKey(voiceId)}-${key}.wav`
  );
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

function writeTmpWav(lang, pcm, voiceId) {
  try {
    fs.writeFileSync(tmpPath(lang, voiceId), pcmToWav(pcm, SAMPLE_RATE));
  } catch (err) {
    console.warn(`[outage-clip] tmp write failed lang=${lang}:`, err?.message || err);
  }
}

function cacheClip(lang, pcm, source, voiceId) {
  if (!pcm?.length) return null;
  const key = lang === 'sw' ? 'sw' : 'en';
  const { id, langs } = slot(voiceId);
  langs[key] = pcm;
  writeTmpWav(key, pcm, id);
  return { pcm, source, language: key, voiceId: id };
}

function clipPresent(lang, voiceId) {
  const key = lang === 'sw' ? 'sw' : 'en';
  const { id, langs } = slot(voiceId);
  if (langs[key]?.length) return { ready: true, source: 'memory', voiceId: id };
  try {
    if (fs.existsSync(tmpPath(key, id))) {
      return { ready: true, source: 'tmp', voiceId: id };
    }
  } catch {
    /* ignore */
  }
  if (isDefaultVoice(id)) {
    try {
      if (fs.existsSync(packagedPath(key))) {
        return { ready: true, source: 'packaged', voiceId: id };
      }
    } catch {
      /* ignore */
    }
  }
  return { ready: false, source: null, voiceId: id };
}

function voiceStatus(voiceId) {
  const en = clipPresent('en', voiceId);
  const sw = clipPresent('sw', voiceId);
  return {
    en: en.ready,
    sw: sw.ready,
    source: { en: en.source, sw: sw.source },
  };
}

/** Cheap /healthz snapshot. Does not decode WAV. */
function getOutageClipStatus() {
  const defaultVoice = getDefaultVoiceId();
  const ids = new Set([defaultVoice, ...Object.keys(memory)]);
  const voices = {};
  for (const id of ids) {
    voices[id] = voiceStatus(id);
  }
  const def = voices[defaultVoice] || voiceStatus(defaultVoice);
  return {
    defaultVoice,
    en: def.en,
    sw: def.sw,
    source: def.source,
    voices,
  };
}

function loadFromVoice(lang, voiceId) {
  const { id, langs } = slot(voiceId);
  if (langs[lang]?.length) {
    return { pcm: langs[lang], source: 'memory', language: lang, voiceId: id };
  }
  const tmp = readWavPcm(tmpPath(lang, id));
  if (tmp) {
    langs[lang] = tmp;
    return { pcm: tmp, source: 'tmp', language: lang, voiceId: id };
  }
  if (isDefaultVoice(id)) {
    const packaged = readWavPcm(packagedPath(lang));
    if (packaged) {
      langs[lang] = packaged;
      return { pcm: packaged, source: 'packaged', language: lang, voiceId: id };
    }
  }
  return null;
}

function loadOutageClip(language, opts = {}) {
  const preferred = outageClipLang(language);
  const order = preferred === 'sw' ? ['sw', 'en'] : ['en'];
  const requested = voiceKey(opts.voiceId);
  const fallback = getDefaultVoiceId();
  const voices = requested === fallback ? [requested] : [requested, fallback];
  for (const voiceId of voices) {
    for (const lang of order) {
      const hit = loadFromVoice(lang, voiceId);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Render downtime lines with live Soniox for one catalog voice.
 * Safe to call while 402: it logs and returns.
 */
async function warmOutageClips(opts = {}) {
  const id = voiceKey(opts.voiceId);
  if (warmingByVoice.has(id)) return warmingByVoice.get(id);

  const work = (async () => {
    const { isSonioxTtsConfigured } = require('./sonioxTts');
    if (!isSonioxTtsConfigured()) {
      return { ok: false, reason: 'soniox_unconfigured', voiceId: id };
    }
    const { synthesizeTtsPreview } = require('./ttsPreview');
    const langs = opts.languages || ['en', 'sw'];
    const warmed = [];
    for (const lang of langs) {
      const { langs: held } = slot(id);
      if (held[lang]?.length) {
        warmed.push(lang);
        continue;
      }
      if (isDefaultVoice(id)) {
        const packaged = readWavPcm(packagedPath(lang));
        if (packaged) {
          cacheClip(lang, packaged, 'packaged', id);
          warmed.push(lang);
          continue;
        }
      }
      try {
        const result = await synthesizeTtsPreview({
          text: pickSpeechOutageLine(lang),
          language: lang,
          callLanguage: lang,
          voiceId: id,
        });
        const pcm = wavBytesTo16kPcm(result.wav);
        if (pcm?.length) {
          cacheClip(lang, pcm, 'soniox', id);
          warmed.push(lang);
          console.log(
            `[outage-clip] warmed clone-voice downtime clip voice=${id} lang=${lang} bytes=${pcm.length}`
          );
        }
      } catch (err) {
        console.warn(
          `[outage-clip] warm failed voice=${id} lang=${lang}:`,
          err?.message || err
        );
      }
    }
    return { ok: warmed.length > 0, warmed, voiceId: id };
  })();

  warmingByVoice.set(id, work);
  try {
    return await work;
  } finally {
    warmingByVoice.delete(id);
  }
}

function scheduleOutageClipWarm(opts = {}) {
  const id = voiceKey(opts.voiceId);
  const { langs } = slot(id);
  if (langs.en && langs.sw) return;
  const now = Date.now();
  if (now - (lastWarmAt[id] || 0) < 60_000) return;
  lastWarmAt[id] = now;
  warmOutageClips({ voiceId: id }).catch((err) => {
    console.warn(`[outage-clip] scheduled warm failed voice=${id}:`, err?.message || err);
  });
}

/** Tests only. */
function resetOutageClipCache() {
  for (const id of Object.keys(memory)) delete memory[id];
  warmingByVoice.clear();
  for (const id of Object.keys(lastWarmAt)) delete lastWarmAt[id];
}

module.exports = {
  loadOutageClip,
  cacheClip,
  warmOutageClips,
  scheduleOutageClipWarm,
  resetOutageClipCache,
  getOutageClipStatus,
  packagedPath,
  tmpPath,
  voiceKey,
};
