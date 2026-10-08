// HD_015bae4a4af2 (staging, 2026-10-08 12:52 EAT): one Soniox stream got three
// trimmed pieces with no gap, so the voice heard "Kee-ten-geh-laInterior" and
// "windowWhat". The caller said "Pardon me?" and reported punctuation read
// aloud. Locks the TTS wire: a word gap between pieces and no letterless piece.
// Punctuation stripping is prepareForTts's job and is unchanged here.
// Run: node tests/ttsBoundary.test.js

const assert = require('assert');
const Module = require('module');
const EventEmitter = require('events');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit('open');
    });
  }

  send(data) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', 1000, Buffer.from(''));
  }
}
FakeWebSocket.CONNECTING = 0;
FakeWebSocket.OPEN = 1;
FakeWebSocket.CLOSED = 3;

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'ws') return FakeWebSocket;
  return originalLoad(request, parent, isMain);
};

process.env.SONIOX_API_KEY = 'test-key';
process.env.SONIOX_VOICE = 'test-voice';

const { createSonioxTtsSession } = require('../src/speech/sonioxTts');
const { wireTextForPiece } = require('../src/speech/ttsBoundary');

function textMessages(streamId) {
  return FakeWebSocket.last.sent.filter(
    (m) => m && m.stream_id === streamId && typeof m.text === 'string' && m.text_end === false
  );
}

async function main() {
  // Pure boundary rules.
  assert.equal(wireTextForPiece(','), '');
  assert.equal(wireTextForPiece(', '), '');
  assert.equal(wireTextForPiece(' - '), '');
  assert.equal(wireTextForPiece('...'), '');
  assert.equal(wireTextForPiece('—'), '');
  assert.equal(wireTextForPiece('Mm-hmm'), 'Mm-hmm');
  assert.equal(wireTextForPiece('  six thousand  shillings ', { first: false }), ' six thousand shillings');
  assert.equal(wireTextForPiece('Sure, one moment.'), 'Sure, one moment.', 'marks are not this module\'s job');
  assert.equal(wireTextForPiece('6', { first: false }), ' 6', 'a digit is speakable');

  const session = createSonioxTtsSession({ callSid: 'boundary-test', onAudio: () => {} });
  await session.ready;

  // T2 as streamed live: three sentences, one stream.
  const t2 = await session.beginSpeak({ language: 'en' });
  for (const piece of [
    'Yes, we cover Kitengela!',
    'Interior window cleaning is KSh 200 per window.',
    ',',
    'What day and time would work for you?',
  ]) {
    t2.pushText(piece);
  }
  const sent = textMessages(t2.streamId);
  assert.equal(sent.length, 3, 'the lone comma piece is never sent');
  for (const msg of sent) {
    assert.match(msg.text, /[\p{L}\p{N}]/u, `piece without a letter: ${JSON.stringify(msg.text)}`);
    assert.doesNotMatch(msg.text, /[,.;:!?…]/, `mark on the wire: ${JSON.stringify(msg.text)}`);
  }
  assert.doesNotMatch(sent[0].text, /^\s/, 'first piece opens the stream with no space');
  for (const msg of sent.slice(1)) {
    assert.match(msg.text, /^ \S/, `later piece must open with one space: ${JSON.stringify(msg.text)}`);
  }
  const heard = sent.map((m) => m.text).join('');
  assert.equal(
    heard,
    'Yes we cover Kitengela Interior window cleaning is two hundred shillings per window What day and time would work for you'
  );
  assert.doesNotMatch(heard, /[a-z][A-Z]/, 'no glued words across pieces');
  t2.cancel();

  // alreadyPrepared paths (replay, local lines) get the same gap and the same
  // letterless refusal; their text is otherwise sent as given.
  const replay = await session.beginSpeak({ language: 'en', alreadyPrepared: true });
  replay.pushText('Sure, one moment.');
  replay.pushText('—');
  replay.pushText('What would you like done?');
  const replaySent = textMessages(replay.streamId).map((m) => m.text);
  assert.deepEqual(replaySent, ['Sure, one moment.', ' What would you like done?']);
  replay.cancel();

  session.close();
  console.log('ttsBoundary.test.js: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
