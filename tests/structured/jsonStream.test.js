const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  createStructuredStreamReader,
  scanStructured,
  parseStructured,
} = require('../../src/speech/structured/jsonStream');

const REPLY = {
  lang: 'en',
  intent: 'services',
  facts_used: [{ kind: 'service', id: 'svc:sofa' }],
  say: ['We offer sofa, carpet and "mattress" cleaning.', 'What would you like done?'],
  end_call: false,
};

describe('structured JSON stream reader', () => {
  it('emits each say item once, as soon as its closing quote arrives', () => {
    const raw = JSON.stringify(REPLY);
    for (const size of [1, 3, 7, 50]) {
      const reader = createStructuredStreamReader();
      const seen = [];
      for (let i = 0; i < raw.length; i += size) seen.push(...reader.push(raw.slice(i, i + size)).fresh);
      assert.deepEqual(seen, REPLY.say, `chunk size ${size}`);
      assert.equal(reader.state().complete, true);
      assert.equal(reader.state().sayClosed, true);
    }
  });

  it('knows facts_used before the first say item (schema order)', () => {
    const raw = JSON.stringify(REPLY);
    const cut = raw.indexOf('We offer') + 3;
    const scan = scanStructured(raw.slice(0, cut));
    assert.equal(scan.sawFactsUsed, true);
    assert.deepEqual(scan.fields.facts_used, REPLY.facts_used);
    assert.equal(scan.say.length, 0);
  });

  it('never mistakes a key name inside a string for a field', () => {
    const raw = JSON.stringify({ lang: 'en', intent: 'other', facts_used: [], say: ['Say "say": now.', 'Two.'] });
    const scan = scanStructured(raw);
    assert.deepEqual(scan.say, ['Say "say": now.', 'Two.']);
  });

  it('handles unicode escapes and a fenced reply', () => {
    const scan = scanStructured('```json\n{"lang":"sw","intent":"other","facts_used":[],"say":["Asante \\u2014 karibu."]}\n```');
    assert.deepEqual(scan.say, ['Asante — karibu.']);
    assert.equal(parseStructured('```json\n{"say":["x"]}\n```').ok, true);
  });

  it('reports a broken reply as a parse failure, not a throw', () => {
    assert.deepEqual(parseStructured('{"say": ["half'), { ok: false, error: 'parse', value: null });
    assert.equal(parseStructured('').error, 'empty');
    assert.equal(parseStructured('[1]').error, 'not_object');
  });
});
