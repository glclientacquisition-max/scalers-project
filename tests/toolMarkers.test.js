const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');

describe('parseGeminiResponse service requests', () => {
  it('parses create_service_request and strips markers from speech', () => {
    const raw =
      'Sure Jane, I will hold two chargers until evening. ###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"charger","quantity":"2","when_text":"evening"}}###ENDTOOL### ###TOOL###{"save_caller_info":{"name":"Jane","reason":"hold charger"}}###ENDTOOL###';
    const parsed = parseGeminiResponse(raw);
    assert.match(parsed.spokenText, /hold two chargers/i);
    assert.doesNotMatch(parsed.spokenText, /###TOOL###/);
    assert.equal(parsed.serviceRequest?.type, 'hold');
    assert.equal(parsed.serviceRequest?.name, 'Jane');
    assert.equal(parsed.serviceRequest?.item, 'charger');
    assert.equal(parsed.serviceRequest?.quantity, '2');
    assert.equal(parsed.serviceRequest?.whenText, 'evening');
    assert.equal(parsed.name, 'Jane');
  });
});
