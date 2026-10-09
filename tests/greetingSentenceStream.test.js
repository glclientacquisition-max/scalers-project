// Greeting is one Soniox stream of sentences, not one push of the whole line.
// Run: node --test tests/greetingSentenceStream.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { speakPreparedSentences } = require('../src/speech/spokenStreamBuffer');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function sliceFn(name) {
  const start = serverSource.indexOf(`async function ${name}`);
  assert.ok(start > 0, name);
  const end = serverSource.indexOf('\n  async function ', start + 10);
  assert.ok(end > start, name);
  return serverSource.slice(start, end);
}

function greetingIife() {
  const start = serverSource.indexOf('// Greet once the tenant profile is loaded');
  const end = serverSource.indexOf("ws.on('message'", start);
  assert.ok(start > 0 && end > start);
  return serverSource.slice(start, end);
}

describe('greeting streams one push per sentence', () => {
  it('pushes each speakable sentence and ends the stream once', async () => {
    const prepared =
      'Good evening, ChapterOne Bookstore, this is Aisha. How can I help?';
    const pushes = [];
    let ends = 0;
    const pcm = Buffer.from('greeting-pcm');
    const { chunks, spoken } = await speakPreparedSentences(
      {
        pushText(text) {
          pushes.push(text);
          return { pushed: true, text };
        },
        async end() {
          ends += 1;
          return { pcm, cancelled: false };
        },
      },
      prepared
    );
    assert.deepEqual(pushes, [
      'Good evening, ChapterOne Bookstore, this is Aisha.',
      'How can I help?',
    ]);
    assert.deepEqual(chunks, pushes);
    assert.equal(ends, 1);
    assert.equal(pushes.includes(prepared), false);
    assert.equal(spoken.pcm, pcm);
  });

  it('wires the greeting IIFE through that stream and keeps the cache', () => {
    const greet = sliceFn('speakGreetingSentences');
    const iife = greetingIife();
    assert.match(greet, /tts\.beginSpeak\(\{/);
    assert.match(greet, /speedScale:\s*1/);
    assert.match(greet, /speakPreparedSentences\(session, prepared\.text\)/);
    assert.match(greet, /putGreetingPcm\(opts\.greetingCacheKey, spoken\.pcm\)/);
    assert.match(greet, /capture:/);
    assert.doesNotMatch(greet, /cutNoAiSlop/);
    assert.doesNotMatch(greet, /session\.pushText\(prepared\.text\)/);
    assert.doesNotMatch(greet, /session\.pushText\(text\)/);
    assert.match(iife, /playCachedFillerPcm\(found\.pcm/);
    assert.match(iife, /speakGreetingSentences\(spokenGreeting,/);
    assert.match(iife, /greetingCacheKey:\s*found\.key/);
    assert.match(iife, /speakGreetingSentences\(fallback\)/);
    const fallbackAt = iife.indexOf('const fallback = buildGreeting');
    assert.ok(fallbackAt > 0);
    const fallbackCall = iife.slice(fallbackAt, fallbackAt + 420);
    assert.match(fallbackCall, /vertical:\s*brainProfile\?\.vertical \|\| ''/);
    assert.doesNotMatch(iife, /speakText\(/);
    assert.doesNotMatch(iife, /cutNoAiSlop/);
    assert.match(serverSource, /speed: speedForLanguage\(prepared\.language\)/);
  });
});
