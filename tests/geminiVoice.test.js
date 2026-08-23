const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractGeminiText,
  extractThoughtSignature,
  buildGeminiContents,
  geminiTurnTimeoutMs,
  withTimeout,
  isTimeoutError,
} = require('../src/conversation/geminiVoice');

describe('extractGeminiText', () => {
  it('skips thought parts', () => {
    const text = extractGeminiText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: 'hidden' },
              { text: 'Hello there' },
            ],
          },
        },
      ],
    });
    assert.equal(text, 'Hello there');
  });
});

describe('extractThoughtSignature', () => {
  it('reads the last part signature', () => {
    const sig = extractThoughtSignature({
      candidates: [
        {
          content: {
            parts: [
              { text: 'hi', thoughtSignature: 'sig-1' },
              { text: 'there', thoughtSignature: 'sig-2' },
            ],
          },
        },
      ],
    });
    assert.equal(sig, 'sig-2');
  });
});

describe('buildGeminiContents', () => {
  it('omits local greetings and system messages', () => {
    const contents = buildGeminiContents([
      { role: 'system', content: 'rules' },
      { role: 'assistant', content: 'Good morning, this is Shy.', local: true },
      { role: 'user', content: 'How are you doing?' },
    ]);
    assert.deepEqual(contents, [
      { role: 'user', parts: [{ text: 'How are you doing?' }] },
    ]);
  });

  it('attaches thought signatures on model turns', () => {
    const contents = buildGeminiContents([
      { role: 'user', content: 'hours?' },
      {
        role: 'assistant',
        content: 'We open at 8.',
        thoughtSignature: 'sig-abc',
      },
    ]);
    assert.equal(contents[1].role, 'model');
    assert.equal(contents[1].parts[0].thoughtSignature, 'sig-abc');
  });
});

describe('withTimeout', () => {
  it('rejects when the work hangs', async () => {
    await assert.rejects(
      () =>
        withTimeout(
          new Promise(() => {}),
          20,
          'Gemini stream'
        ),
      /Gemini stream timed out after 20ms/
    );
  });

  it('resolves when work finishes first', async () => {
    const value = await withTimeout(Promise.resolve('ok'), 50, 'Gemini stream');
    assert.equal(value, 'ok');
  });

  it('recognizes timeout errors', () => {
    assert.equal(isTimeoutError(new Error('Gemini stream timed out after 8000ms')), true);
    assert.equal(isTimeoutError(new Error('503 unavailable')), false);
  });
});

describe('geminiTurnTimeoutMs', () => {
  it('defaults to 8000 when unset or invalid', () => {
    const prev = process.env.GEMINI_TURN_TIMEOUT_MS;
    delete process.env.GEMINI_TURN_TIMEOUT_MS;
    assert.equal(geminiTurnTimeoutMs(), 8000);
    process.env.GEMINI_TURN_TIMEOUT_MS = '200';
    assert.equal(geminiTurnTimeoutMs(), 8000);
    if (prev == null) delete process.env.GEMINI_TURN_TIMEOUT_MS;
    else process.env.GEMINI_TURN_TIMEOUT_MS = prev;
  });
});
