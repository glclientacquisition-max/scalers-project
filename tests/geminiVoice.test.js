const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractGeminiText,
  extractThoughtSignature,
  appendGeminiStreamParts,
  buildGeminiContents,
  geminiTurnTimeoutMs,
  withTimeout,
  isTimeoutError,
  classifyGeminiError,
  isRetryableGeminiError,
  isHardGeminiOutage,
  nextGeminiStreamAttempt,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_BACKUP_MODEL,
  resolvePrefetchedStreamSpeech,
  spokenTextForToolTurn,
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

  it('strips instruction labels from replayed model parts', () => {
    const contents = buildGeminiContents([
      { role: 'user', content: 'Uh, not currently' },
      {
        role: 'assistant',
        content: 'Sawa, Alvin.',
        geminiParts: [
          {
            text: 'ASR_CORRECTION_PROMPT: The user\'s input seems truncated or quiet. Ask for missing details or to repeat gently. RETOTI: Sawa, Alvin!',
          },
        ],
      },
    ]);
    assert.equal(contents[1].parts[0].text, 'Sawa, Alvin!');
    assert.doesNotMatch(contents[1].parts[0].text, /ASR_CORRECTION_PROMPT|RETOTI/);
  });

  it('replays stored model parts without merging a signed part into text', () => {
    const contents = buildGeminiContents([
      { role: 'user', content: 'book tomorrow' },
      {
        role: 'assistant',
        content: 'Which service?',
        geminiParts: [
          { thought: true, text: 'reason', thoughtSignature: 'sig-thought' },
          { text: 'Which service?' },
          { text: '', thoughtSignature: 'sig-final' },
        ],
      },
      { role: 'user', content: 'Carpet cleaning.' },
    ]);
    assert.deepEqual(contents[1].parts, [
      { thought: true, text: 'reason', thoughtSignature: 'sig-thought' },
      { text: 'Which service?' },
      { text: '', thoughtSignature: 'sig-final' },
    ]);
    assert.equal(contents[2].parts[0].text, 'Carpet cleaning.');
  });

  it('merges consecutive user turns after a failed Gemini attempt', () => {
    const contents = buildGeminiContents([
      { role: 'user', content: 'book tomorrow' },
      { role: 'user', content: 'carpet cleaning' },
    ]);
    assert.deepEqual(contents, [
      { role: 'user', parts: [{ text: 'book tomorrow carpet cleaning' }] },
    ]);
  });
});

describe('appendGeminiStreamParts', () => {
  it('keeps an empty signed trailer part', () => {
    let parts = [];
    parts = appendGeminiStreamParts(parts, {
      candidates: [{ content: { parts: [{ text: 'Which service?' }] } }],
    });
    parts = appendGeminiStreamParts(parts, {
      candidates: [{ content: { parts: [{ text: '', thoughtSignature: 'sig-end' }] } }],
    });
    assert.deepEqual(parts, [
      { text: 'Which service?' },
      { text: '', thoughtSignature: 'sig-end' },
    ]);
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

describe('spokenTextForToolTurn', () => {
  it('drops model prose when an outcome tool ran', () => {
    assert.equal(
      spokenTextForToolTurn({
        spoken: 'Let me book that for you now.',
        toolResults: [{ action: 'create_appointment', status: 'invalid' }],
      }),
      ''
    );
  });

  it('keeps the answer when escalate already happened', () => {
    assert.equal(
      spokenTextForToolTurn({
        spoken: 'What happens next is they call you.',
        toolResults: [{ action: 'escalate', status: 'duplicate' }],
      }),
      'What happens next is they call you.'
    );
  });

  it('keeps model prose when no outcome tool ran', () => {
    assert.equal(
      spokenTextForToolTurn({
        spoken: 'We open at 8 A M.',
        toolResults: [],
      }),
      'We open at 8 A M.'
    );
  });
});

describe('resolvePrefetchedStreamSpeech', () => {
  const fallback = "Sorry, I'm having a technical issue and couldn't complete that. Please try again.";

  it('does not speak again when stream chunks already played', () => {
    const out = resolvePrefetchedStreamSpeech({
      spokenChunks: 'Which service do you need?',
      spokenText: 'Which service do you need?',
      fallbackLine: fallback,
    });
    assert.equal(out.alreadySpoken, true);
    assert.equal(out.speakNow, false);
  });

  it('speaks a timeout fallback once when prefetch opened with no chunks', () => {
    const out = resolvePrefetchedStreamSpeech({
      spokenChunks: '',
      spokenText: fallback,
      timedOut: true,
      llmFailed: true,
      fallbackLine: fallback,
    });
    assert.equal(out.alreadySpoken, false);
    assert.equal(out.speakNow, true);
    assert.equal(out.reply, fallback);
  });

  it('leaves empty successful output for the turn guarantee', () => {
    const out = resolvePrefetchedStreamSpeech({
      spokenChunks: '',
      spokenText: '',
      fallbackLine: fallback,
    });
    assert.equal(out.speakNow, false);
    assert.equal(out.reply, '');
  });
});

describe('classifyGeminiError', () => {
  it('does not retry billing or denied projects', () => {
    const billing = classifyGeminiError({
      status: 429,
      message: 'Your prepayment credits are depleted. Please go to AI Studio',
    });
    assert.equal(billing.retryable, false);
    assert.equal(billing.kind, 'billing');
    assert.equal(
      isRetryableGeminiError({
        status: 403,
        message: 'Your project has been denied access',
      }),
      false
    );
  });

  it('retries overload 429s', () => {
    assert.equal(
      isRetryableGeminiError({ status: 429, message: 'RESOURCE_EXHAUSTED overloaded' }),
      true
    );
  });

  it('keeps the reach-them line for credits and a denied project only', () => {
    assert.equal(
      isHardGeminiOutage({
        status: 429,
        message: 'Your prepayment credits are depleted. Please go to AI Studio',
      }),
      true
    );
    assert.equal(
      isHardGeminiOutage({ status: 403, message: 'Your project has been denied access' }),
      true
    );
    assert.equal(
      isHardGeminiOutage({
        status: 503,
        message:
          'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
      }),
      false
    );
    assert.equal(isHardGeminiOutage(new Error('Incomplete JSON segment at the end')), false);
    assert.equal(isHardGeminiOutage(null), false);
  });
});

describe('nextGeminiStreamAttempt', () => {
  const busy = {
    status: 503,
    message: 'This model is currently experiencing high demand.',
  };
  const cut = new Error('Incomplete JSON segment at the end');
  const billing = {
    status: 429,
    message: 'Your prepayment credits are depleted.',
  };

  it('retries a 503 once, then uses the backup once', () => {
    const first = nextGeminiStreamAttempt({ err: busy, attempt: 0, spoke: false });
    assert.equal(first.action, 'retry');
    assert.equal(first.model, DEFAULT_GEMINI_MODEL);
    const second = nextGeminiStreamAttempt({ err: busy, attempt: 1, spoke: false });
    assert.equal(second.action, 'backup');
    assert.equal(second.model, DEFAULT_GEMINI_BACKUP_MODEL);
    const third = nextGeminiStreamAttempt({ err: busy, attempt: 2, spoke: false });
    assert.equal(third.action, 'stop');
  });

  it('retries a cut stream once and does not switch model', () => {
    const first = nextGeminiStreamAttempt({ err: cut, attempt: 0, spoke: false });
    assert.equal(first.action, 'retry');
    const second = nextGeminiStreamAttempt({ err: cut, attempt: 1, spoke: false });
    assert.equal(second.action, 'stop');
  });

  it('does not retry after audio started or when credits are gone', () => {
    assert.equal(
      nextGeminiStreamAttempt({ err: busy, attempt: 0, spoke: true }).action,
      'stop'
    );
    assert.equal(
      nextGeminiStreamAttempt({ err: billing, attempt: 0, spoke: false }).action,
      'stop'
    );
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
