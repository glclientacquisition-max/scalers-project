const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { cutNoAiSlop } = require('../src/speech/noAiSlop');
const { formatNameConfirmSpeech } = require('../src/conversation/openLineSpeech');

describe('cutNoAiSlop', () => {
  it('drops a throat-clearing sentence and keeps the rest', () => {
    assert.equal(
      cutNoAiSlop("Let's dive in. We can do the couch tomorrow."),
      'We can do the couch tomorrow.'
    );
  });

  it('keeps a sentence when the cut would leave nothing to say', () => {
    assert.equal(cutNoAiSlop("It's worth noting."), "It's worth noting.");
  });

  it('strips a tool leak and does not speak the marker', () => {
    const said = cutNoAiSlop(
      '###TOOL### {"name":"bookVisit"} ###ENDTOOL### We can do the couch tomorrow.'
    );
    assert.equal(said, 'We can do the couch tomorrow.');
    assert.doesNotMatch(said, /###|TOOL|bookVisit|\{/);
  });

  it('does not speak a JSON-only leak', () => {
    assert.equal(cutNoAiSlop('{"tool":"book"}'), '');
  });

  it('strips markdown so the voice does not say asterisk', () => {
    const said = cutNoAiSlop('*couch* cleaning');
    assert.equal(said, 'couch cleaning');
    assert.doesNotMatch(said, /asterisk|\*/i);
  });

  it('leaves a real period in place and does not say the word period', () => {
    assert.equal(
      cutNoAiSlop('We can do the couch tomorrow.'),
      'We can do the couch tomorrow.'
    );
    assert.equal(cutNoAiSlop('Call me in that period.'), 'Call me in that period.');
  });

  it('passes a visit sentence through the exempt path unchanged', () => {
    const empty = formatNameConfirmSpeech({
      language: 'en',
      openVisits: [],
      openRequests: [],
    });
    assert.equal(empty, 'Nothing is still open. What would you like to do?');
    assert.equal(cutNoAiSlop(empty, { exempt: true }), empty);
    assert.match(cutNoAiSlop('Nothing is still open.', { exempt: true }), /^Nothing is still open\.$/);

    const named = formatNameConfirmSpeech({
      language: 'en',
      openVisits: ['robust cleaning | tomorrow 12:00 PM | requested | Westlands'],
      openRequests: [],
    });
    assert.match(named, /robust cleaning/);
    assert.equal(cutNoAiSlop(named, { exempt: true }), named);
  });
});

describe('server speech path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  function body(name, indent) {
    const marker = `\n${indent}async function ${name}`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, name);
    const end = source.indexOf(`\n${indent}async function `, start + marker.length);
    assert.ok(end > start, name);
    return source.slice(start, end);
  }

  it('cuts model text before the Soniox push and not the lookup sentence', () => {
    const chunk = body('onSpokenChunk', '      ');
    assert.match(chunk, /text = cutNoAiSlop\(text\)/);
    assert.match(chunk, /session\.pushText\(text\)/);
    const lookupStart = source.indexOf('async function speakLookupSentence');
    const lookupEnd = source.indexOf('\n      let result;', lookupStart);
    assert.ok(lookupStart > 0 && lookupEnd > lookupStart);
    const lookup = source.slice(lookupStart, lookupEnd);
    assert.doesNotMatch(lookup, /cutNoAiSlop/);
    assert.match(lookup, /nameConfirmSpeech/);
    assert.match(lookup, /session\.pushText\(sentence\)/);
    assert.doesNotMatch(body('speakText', '  '), /cutNoAiSlop/);
  });

  it('does not cut the greeting or the empty-speech recovery', () => {
    const greetingAt = source.indexOf('greeting mode=instant');
    assert.ok(greetingAt > 0);
    assert.doesNotMatch(source.slice(greetingAt, greetingAt + 700), /cutNoAiSlop/);
    const emptyAt = source.indexOf('planEmptyGeminiSpeech');
    assert.ok(emptyAt > 0);
    assert.doesNotMatch(source.slice(emptyAt, emptyAt + 900), /cutNoAiSlop/);
    const outageAt = source.indexOf('async function handleSpeechProviderOutage');
    assert.ok(outageAt > 0);
    const outageEnd = source.indexOf('\n  async function ', outageAt + 10);
    assert.doesNotMatch(source.slice(outageAt, outageEnd), /cutNoAiSlop/);
  });
});
