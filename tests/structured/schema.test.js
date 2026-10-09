const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  structuredResponseSchema,
  structuredGeminiConfig,
  correctionTurn,
  outputContract,
} = require('../../src/speech/structured/schema');

describe('structured response schema', () => {
  it('locks lang to one enum value and orders facts_used before say', () => {
    const schema = structuredResponseSchema('sw');
    assert.deepEqual(schema.properties.lang.enum, ['sw']);
    assert.deepEqual(schema.propertyOrdering, ['lang', 'intent', 'facts_used', 'say', 'tool', 'end_call']);
    assert.ok(schema.propertyOrdering.indexOf('facts_used') < schema.propertyOrdering.indexOf('say'));
    assert.deepEqual(schema.required, ['lang', 'intent', 'facts_used', 'say']);
  });

  it('caps say at 1 to 3 strings (int64 fields go as strings)', () => {
    const say = structuredResponseSchema('en').properties.say;
    assert.equal(say.minItems, '1');
    assert.equal(say.maxItems, '3');
    assert.equal(say.items.type, 'STRING');
  });

  it('builds a JSON request config with the facts block and contract', () => {
    const config = structuredGeminiConfig('SYSTEM', { locked: 'en', factsBlock: 'GROUNDED FACTS: x', env: {} });
    assert.equal(config.responseMimeType, 'application/json');
    assert.deepEqual(config.responseSchema.properties.lang.enum, ['en']);
    const text = config.systemInstruction.parts[0].text;
    assert.ok(text.startsWith('SYSTEM'));
    assert.match(text, /GROUNDED FACTS: x/);
    assert.match(text, /OUTPUT CONTRACT/);
    assert.equal(config.maxOutputTokens, 512);
  });

  it('maps the legacy tool and end-call markers onto fields', () => {
    const contract = outputContract('en');
    assert.match(contract, /tool\.name/);
    assert.match(contract, /end_call: true only where/);
    assert.match(contract, /Never write ###TOOL###/);
  });

  it('the correction turn names the problem and the locked language', () => {
    const turn = correctionTurn('sw', [{ code: 'language', detail: 'written in en', sentence: 'Hello.' }]);
    assert.equal(turn.role, 'user');
    assert.match(turn.parts[0].text, /language/);
    assert.match(turn.parts[0].text, /"sw"/);
    assert.match(turn.parts[0].text, /Kiswahili|Swahili/);
  });
});
