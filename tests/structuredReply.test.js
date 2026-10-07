const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createSpokenSentenceParser } = require('../src/speech/jsonSentenceStream');
const {
  validateStructuredReply,
  protectSpokenAnswer,
  normalizeStructuredSentence,
  correctiveInstruction,
} = require('../src/speech/structuredReply');
const { composeDeterministicReply, speakStructuredTurn } = require('../src/speech/structuredReplay');
const { runStructuredGeminiTurn } = require('../src/speech/structuredGeminiTurn');
const { prepareForTts } = require('../src/speech/ttsNormalize');

const SERVICES = ['Ni services gani mna offer?', 'Mnaofa services gani?', 'What services do you offer?'];

function jsonFor(language, sentences) {
  return JSON.stringify({
    reply_language: language,
    spoken_sentences: sentences,
    intent: 'services',
    answered_question: true,
    needs_handoff: false,
  });
}

async function* textStream(text) {
  const step = 18;
  for (let i = 0; i < text.length; i += step) {
    yield { text: text.slice(i, i + step) };
  }
}

describe('structured reply schema', () => {
  it('accepts a locked-language sentence list', () => {
    const checked = validateStructuredReply(
      {
        reply_language: 'sw',
        spoken_sentences: ['Tuna huduma za couch cleaning.'],
        intent: 'services',
        answered_question: true,
        needs_handoff: false,
      },
      'sw'
    );
    assert.equal(checked.ok, true);
    assert.match(checked.sentences[0], /couch cleaning/);
  });

  it('rejects the wrong language and asks for one regeneration', () => {
    const checked = validateStructuredReply(
      {
        reply_language: 'sw',
        spoken_sentences: ['Tuna huduma za couch cleaning.'],
        intent: 'services',
        answered_question: true,
        needs_handoff: false,
      },
      'en'
    );
    assert.equal(checked.ok, false);
    assert.ok(checked.problems.includes('language_mismatch'));
    assert.match(correctiveInstruction('en', checked.problems), /locked reply language is en/);
  });

  it('regenerates once and still speaks when the first JSON is the wrong language', async () => {
    const calls = [];
    const spoken = [];
    const result = await runStructuredGeminiTurn({
      messages: [],
      systemPrompt: 'Reply as JSON only.',
      lockedLanguage: 'en',
      timeoutMs: 2000,
      onSentence: async (sentence) => {
        spoken.push(sentence);
      },
      applyTools: async () => ({ results: [], shouldEndCall: false }),
      startStream: async () => {
        calls.push(1);
        const body =
          calls.length === 1
            ? jsonFor('sw', ['Tuna huduma za couch cleaning.'])
            : jsonFor('en', ['We offer couch cleaning.']);
        return textStream(body);
      },
    });
    assert.equal(calls.length, 2);
    assert.match(result.spokenText, /couch cleaning/);
    assert.match(spoken.join(' '), /We offer couch cleaning/);
    assert.equal(result.llmFailed, false);
    assert.equal(result.llmHardDown, false);
  });
});

describe('no silent drop', () => {
  it('restores a non-empty answer that normalization would erase', () => {
    const guarded = protectSpokenAnswer('We offer couch cleaning and carpet cleaning.', '');
    assert.equal(guarded.restored, true);
    assert.equal(guarded.reason, 'blocked_empty_drop');
    assert.match(guarded.text, /couch cleaning/);
  });

  it('refuses to leave only a closing question', () => {
    const guarded = protectSpokenAnswer(
      'We offer couch cleaning and carpet cleaning.',
      'How can I help?'
    );
    assert.equal(guarded.restored, true);
    assert.equal(guarded.reason, 'blocked_closing_only');
    assert.match(guarded.text, /couch cleaning/);
  });

  it('keeps a services list for English and Kiswahili asks', () => {
    for (const caller of SERVICES) {
      const replyLang = caller.startsWith('What') ? 'en' : 'sw';
      const spoken = speakStructuredTurn({
        caller,
        recorded: 'What do you need done?',
        replyLang,
        state: { caller: { name: 'Alvin', nameConfirmed: true } },
        fixture: { businessName: 'Done and Dusted' },
      });
      assert.match(spoken.spoken, /clean/i, caller);
      assert.ok(spoken.spoken.trim().length > 20, caller);
      assert.equal(spoken.stages.some((row) => row.dropped), false);
    }
  });

  it('keeps a price the model already said', () => {
    const english = composeDeterministicReply({
      caller: 'How much is couch cleaning?',
      recorded: 'Couch cleaning is 2500.',
      replyLang: 'en',
    });
    assert.match(english.spoken_sentences.join(' '), /2500/);
    const swahili = composeDeterministicReply({
      caller: 'Bei ngapi?',
      recorded: 'Bei ni 2500.',
      replyLang: 'sw',
    });
    assert.match(swahili.spoken_sentences.join(' '), /2500/);
  });
});

describe('sentence streaming', () => {
  it('emits each spoken sentence when its quote closes', () => {
    const parser = createSpokenSentenceParser();
    const json = jsonFor('en', ['We offer couch cleaning.', 'Bring it to the gate tomorrow.']);
    const heard = [];
    let firstAt = -1;
    for (let i = 0; i < json.length; i += 7) {
      const tick = parser.push(json.slice(i, i + 7));
      if (tick.sentences.length && firstAt < 0) firstAt = i;
      heard.push(...tick.sentences);
    }
    assert.deepEqual(heard, ['We offer couch cleaning.', 'Bring it to the gate tomorrow.']);
    assert.ok(firstAt >= 0 && firstAt < json.length - 2);
  });
});

describe('punctuation is not voiced', () => {
  for (const language of ['en', 'sw']) {
    it(`strips symbols in ${language}`, () => {
      const line =
        language === 'sw'
          ? 'Bei ni shilingi & ofa — sasa... (leo) *huduma* #moja.'
          : 'Hello & friends — wait... (now) *bold* #tag.';
      const prepared = prepareForTts(line, { callLanguage: language, avoidRespell: true });
      const normalized = normalizeStructuredSentence(line, { language });
      for (const spoken of [prepared.text, normalized.text]) {
        assert.equal(spoken.includes('&'), false, spoken);
        assert.equal(spoken.includes('—'), false, spoken);
        assert.equal(spoken.includes('...'), false, spoken);
        assert.equal(spoken.includes('('), false, spoken);
        assert.equal(spoken.includes(')'), false, spoken);
        assert.equal(spoken.includes('*'), false, spoken);
        assert.equal(spoken.includes('#'), false, spoken);
      }
    });
  }
});
