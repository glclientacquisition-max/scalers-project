// Speak-DNA Phase 1. Catalogue items are sentences. List and name ask
// are one session. Run: node --test tests/spokenList.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { renderSpokenList, planSpokenSentences } = require('../src/speech/spokenList');
const { prepareForTts } = require('../src/speech/ttsNormalize');
const { offerCatalogueLine } = require('../src/conversation/knownFacts');
const { looksLikeOfferAsk, looksLikeTruncatedOfferAsk } = require('../src/conversation/fileRead');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { linesBeforeNameAsk, lockFileNameAsk } = require('../src/speech/callerFileSpeech');

const SW_CATALOGUE =
  'Tuna Couch cleaning. Mattress cleaning. Carpet cleaning. Na General cleaning. Na zingine. Unahitaji gani?';
const EN_CATALOGUE =
  'We offer Couch cleaning. Mattress cleaning. Carpet cleaning. And General cleaning. And more. Which one do you need?';

const SW_ITEMS = ['Couch cleaning', 'Mattress cleaning', 'Carpet cleaning', 'General cleaning'];

function spokenChunks(sentences, callLanguage) {
  return sentences.map((sentence) => prepareForTts(sentence, { callLanguage }).text);
}

describe('renderSpokenList', () => {
  it('gives a Kiswahili catalogue a period after each item and na only on the last', () => {
    const line = renderSpokenList({
      items: SW_ITEMS,
      lang: 'sw',
      more: true,
      closer: 'Unahitaji gani?',
      lead: 'Tuna',
    });
    assert.equal(line, SW_CATALOGUE);
    assert.doesNotMatch(line, /\band\b/i);
    assert.doesNotMatch(line, /\bna and\b/i);
    assert.equal(line.split('. ').length, 6);
  });

  it('uses the same na mouth for Sheng', () => {
    assert.equal(
      renderSpokenList({
        items: SW_ITEMS,
        lang: 'sheng',
        more: true,
        closer: 'Unahitaji gani?',
        lead: 'Tuna',
      }),
      SW_CATALOGUE
    );
  });

  it('is the English twin, with and only on the last item', () => {
    const line = renderSpokenList({
      items: SW_ITEMS,
      lang: 'en',
      more: true,
      closer: 'Which one do you need?',
      lead: 'We offer',
    });
    assert.equal(line, EN_CATALOGUE);
    assert.doesNotMatch(line, /\bna\b/i);
    assert.doesNotMatch(line, /\band and\b/i);
    assert.doesNotMatch(line, /Mattress cleaning\. And Carpet/);
  });

  it('does not put a conjunction on a single item', () => {
    assert.equal(
      renderSpokenList({
        items: ['Couch cleaning'],
        lang: 'sw',
        lead: 'Tuna',
        closer: 'Unahitaji gani?',
      }),
      'Tuna Couch cleaning. Unahitaji gani?'
    );
  });

  it('omits the closer when the caller only gets the list', () => {
    assert.equal(
      renderSpokenList({
        items: ['Couch cleaning', 'Mattress cleaning'],
        lang: 'en',
        lead: 'We offer',
      }),
      'We offer Couch cleaning. And Mattress cleaning.'
    );
  });
});

describe('catalogue mouth', () => {
  it('speaks service names only, with item periods, from the file', () => {
    const line = offerCatalogueLine(
      'Niambie huduma zenu.',
      {
        servicesCatalog: [
          { name: 'Couch cleaning', notes: 'includes cushions' },
          { name: 'Mattress cleaning' },
          { name: 'Carpet cleaning' },
          { name: 'General cleaning (houses & air bnbs)' },
          { name: 'Pet stain removal' },
        ],
      },
      'sw'
    );
    assert.equal(line, SW_CATALOGUE);
    assert.doesNotMatch(line, /\band\b|\(|houses|cushions|air bnbs/i);
  });
});

describe('one session for the list and the ask', () => {
  it('splits on the periods before punct strip, and keeps the name ask in that list', () => {
    const sentences = planSpokenSentences([SW_CATALOGUE, 'Je, naongea na Alvin?']);
    assert.deepEqual(sentences, [
      'Tuna Couch cleaning.',
      'Mattress cleaning.',
      'Carpet cleaning.',
      'Na General cleaning.',
      'Na zingine.',
      'Unahitaji gani?',
      'Je, naongea na Alvin?',
    ]);
    const spoken = spokenChunks(sentences, 'sw');
    assert.deepEqual(spoken, [
      'Tuna Couch cleaning',
      'Mattress cleaning',
      'Carpet cleaning',
      'Na General cleaning',
      'Na zingine',
      'Unahitaji gani',
      'Je naongea na Alvin',
    ]);
    assert.equal(spoken.join(' | ').includes(' | '), true);
    for (const chunk of spoken) {
      assert.doesNotMatch(chunk, /\bna and\b|\band\b|[.,!?]/i);
    }
    assert.equal(/\bna\b/i.test(spoken[1]), false);
    assert.equal(/\bna\b/i.test(spoken[2]), false);
    assert.match(spoken[3], /^Na General cleaning$/);
  });

  it('prepares the English twin as separate beats with no na', () => {
    const spoken = spokenChunks(planSpokenSentences([EN_CATALOGUE]), 'en');
    assert.deepEqual(spoken, [
      'We offer Couch cleaning',
      'Mattress cleaning',
      'Carpet cleaning',
      'And General cleaning',
      'And more',
      'Which one do you need',
    ]);
    assert.doesNotMatch(spoken.join(' '), /\bna\b|\band and\b/i);
    assert.equal(/\band\b/i.test(spoken[1]), false);
    assert.equal(/\band\b/i.test(spoken[2]), false);
  });

  it('still refuses na and on a Phase 0 comma line', () => {
    const prepared = prepareForTts(
      'Tuna Couch cleaning, Mattress cleaning, Carpet cleaning, na General cleaning, na zingine. Unahitaji gani?',
      { callLanguage: 'sw' }
    );
    assert.doesNotMatch(prepared.text, /\bna and\b|\band\b/i);
    assert.match(prepared.text, /\bna zingine\b/);
  });

  it('puts the catalogue and the name ask on one speakText', () => {
    const services = {
      servicesCatalog: [{ name: 'Carpet cleaning' }, { name: 'Sofa cleaning' }],
    };
    const line = offerCatalogueLine('What services do you offer?', services, 'sw');
    const lines = linesBeforeNameAsk({
      localReply: { outcome: 'catalogue', line },
      nameAsk: lockFileNameAsk('Am I speaking with Alvin?', 'sw'),
      state: {
        caller: { nameConfirmed: false, fileNameAsked: 'Alvin' },
        returning: { name: 'Alvin', fileOwnerName: 'Alvin' },
      },
    });
    const sentences = planSpokenSentences(lines);
    assert.deepEqual(sentences, [
      'Tuna Carpet cleaning.',
      'Na Sofa cleaning.',
      'Unahitaji gani?',
      'Je, naongea na Alvin?',
    ]);
    assert.equal(sentences.length > lines.length, true);

    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = source.indexOf('const nameAskLines = linesBeforeNameAsk');
    const catalogue = source.indexOf('if (catalogueLine)', start);
    const end = source.indexOf('speechHold = holdCallerSpeech', start);
    assert.ok(start > 0 && catalogue > start && end > catalogue);
    const block = source.slice(start, catalogue);
    assert.match(block, /sentenceBreaks:\s*true/);
    assert.match(block, /questionText/);
    assert.match(block, /await speakText\(nameAskLines\.join\(' '\)/);
    assert.equal(block.match(/await speakText\(/g).length, 1);
    assert.doesNotMatch(block, /await speakText\(line\)/);
    assert.match(
      source,
      /opts\.sentenceBreaks[\s\S]{0,240}splitSpeakableChunks\(text, \{ final: true \}\)/
    );
    const stream = fs.readFileSync(
      path.join(__dirname, '..', 'src/speech/spokenStreamBuffer.js'),
      'utf8'
    );
    assert.match(stream, /envInt\('VOICE_STREAM_EARLY_CHARS', 0\)/);
  });

  it('speaks a prepared catalogue local line, including a truncated offer ask', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const turnStart = source.indexOf('async function runCallerTurn');
    const turnEnd = source.indexOf('function flushUtterance', turnStart);
    assert.ok(turnStart > 0 && turnEnd > turnStart);
    const turn = source.slice(turnStart, turnEnd);
    assert.match(turn, /if \(localReply && !catalogueLine\)/);
    assert.match(turn, /local line not spoken/);
    const spokenAt = turn.indexOf('catalogue spoken lang=');
    const streamAt = turn.indexOf('const streamOn');
    assert.ok(spokenAt > 0 && streamAt > spokenAt);
    const override = turn.slice(spokenAt, streamAt);
    assert.match(override, /await speakText\(catalogueLine,/);
    assert.match(override, /sentenceBreaks:\s*true/);
    assert.match(override, /return;/);
    assert.doesNotMatch(override, /not spoken/);
    assert.doesNotMatch(turn, /catalogue local line not spoken/);

    const profile = {
      servicesCatalog: SW_ITEMS.map((name) => ({ name })),
    };
    const asks = [
      [
        'Nilikuwa nataka kujua,',
        'sw',
        'Tuna Couch cleaning. Mattress cleaning. Carpet cleaning. Na General cleaning. Unahitaji gani?',
      ],
      [
        'I wanted to know,',
        'en',
        'We offer Couch cleaning. Mattress cleaning. Carpet cleaning. And General cleaning. Which one do you need?',
      ],
      [
        'what do you',
        'en',
        'We offer Couch cleaning. Mattress cleaning. Carpet cleaning. And General cleaning. Which one do you need?',
      ],
    ];
    for (const [text, lang, expected] of asks) {
      assert.equal(looksLikeTruncatedOfferAsk(text), true);
      assert.equal(looksLikeOfferAsk(text), true);
      const brain = observeCallerTurn(createBrainState({ vertical: 'home_services' }), {
        text,
        detectedLanguage: lang,
        resolvedLanguage: lang,
      });
      const local = resolveLocalReply({ text, state: brain, language: lang, profile });
      assert.equal(local && local.outcome, 'catalogue');
      assert.equal(local.line, expected);
    }
    assert.equal(looksLikeOfferAsk('Nilikuwa nataka kujua bei'), false);
    assert.equal(looksLikeOfferAsk('I wanted to know the price'), false);
    assert.equal(looksLikeOfferAsk('I wanted to know your hours'), false);
    assert.equal(looksLikeTruncatedOfferAsk('Nilikuwa nataka kujua kuhusu'), false);
  });
});
