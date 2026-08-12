// One-shot Soniox TTS for desk phone preview (same voice + prepareForTts path as live calls).

const { createSonioxTtsSession, SAMPLE_RATE } = require('./sonioxTts');
const { prepareForTts } = require('./ttsNormalize');
const { pcmToWav } = require('./wavPack');
const { parseLexiconOverrides } = require('./pronunciationLexicon');

/**
 * Synthesize preview audio with the Scalers cloned voice.
 * @param {{ text: string, callLanguage?: string, language?: string, lexicon?: unknown }} opts
 * @returns {Promise<{ wav: Buffer, spokenText: string, language: string }>}
 */
async function synthesizeTtsPreview(opts) {
  const rawText = String(opts.text || '').trim();
  if (!rawText) {
    throw new Error('text is required');
  }

  const extraLexicon = opts.lexicon ? parseLexiconOverrides(opts.lexicon) : [];
  const prepared = prepareForTts(rawText, {
    callLanguage: opts.callLanguage,
    language: opts.language,
    extraLexicon,
  });

  if (!prepared.text) {
    throw new Error('nothing to speak after TTS prep');
  }

  const chunks = [];
  const session = createSonioxTtsSession({
    callSid: 'preview',
    onAudio: (pcm) => {
      if (pcm?.length) chunks.push(pcm);
    },
  });

  try {
    await session.ready;
    await session.speak(prepared.text, {
      language: prepared.language,
      callLanguage: opts.callLanguage,
      alreadyPrepared: true,
      extraLexicon,
    });
  } finally {
    session.close();
  }

  const pcm = Buffer.concat(chunks);
  if (!pcm.length) {
    throw new Error('Soniox returned no audio');
  }

  const wav = pcmToWav(pcm, SAMPLE_RATE);
  return {
    wav,
    spokenText: prepared.text,
    language: prepared.language,
  };
}

module.exports = { synthesizeTtsPreview };
