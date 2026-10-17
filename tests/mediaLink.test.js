'use strict';

// Media link hardening: VOICE_MEDIA_PACING (default off) plus always-on link
// logs. Evidence: HD_ad18fd9088e0 and HD_60e56c6acc88 (media WS connected
// 4.5-6 s after answer, ±0.3 s jitter, 1006 closes).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ml = require('../src/speech/mediaLink');

const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function fakeClock() {
  let t = 0;
  const timers = new Map();
  let id = 0;
  return {
    now: () => t,
    setTimer: (fn, ms) => {
      id += 1;
      timers.set(id, { fn, ms, next: t + ms });
      return id;
    },
    clearTimer: (h) => timers.delete(h),
    timers,
    /** Advance time; interval timers fire at their due times, optionally late. */
    advance(ms, { lateBy = 0 } = {}) {
      const end = t + ms;
      for (;;) {
        let due = null;
        for (const [h, tm] of timers) if (tm.next <= end && (!due || tm.next < due[1].next)) due = [h, tm];
        if (!due) break;
        t = due[1].next + lateBy;
        due[1].next = t + due[1].ms;
        due[1].fn();
        if (t > end) break;
      }
      t = Math.max(t, end);
    },
  };
}

function pcm(ms) {
  const buf = Buffer.alloc((ms / 20) * 640);
  for (let i = 0; i < buf.length; i += 1) buf[i] = i % 251;
  return buf;
}

function pacerWith(clock, extra = {}) {
  const sent = [];
  const pacer = ml.createPcmPacer({
    send: (frame) => sent.push({ at: clock.now(), frame }),
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...extra,
  });
  return { pacer, sent };
}

test('flag is off unless on/1/true/yes', () => {
  assert.equal(ml.mediaPacingEnabled({}), false);
  assert.equal(ml.mediaPacingEnabled({ VOICE_MEDIA_PACING: 'off' }), false);
  for (const v of ['on', '1', 'true', 'YES']) assert.equal(ml.mediaPacingEnabled({ VOICE_MEDIA_PACING: v }), true);
});

test('pacing: 20 ms frames, 200 ms lead up front, then one frame per 20 ms', () => {
  const clock = fakeClock();
  const { pacer, sent } = pacerWith(clock);
  pacer.enqueue(pcm(1000)); // 50 frames
  assert.equal(sent.length, 10, '200 ms lead goes out at once');
  assert.ok(sent.every((s) => s.frame.length === 640));
  clock.advance(1000);
  assert.equal(sent.length, 50);
  // Frame k leaves at (k - 9) * 20 ms (k >= 10): never more than 200 ms ahead.
  sent.forEach((s, k) => {
    const playsAt = k * 20;
    assert.ok(playsAt - s.at <= 200, `frame ${k} lead ${playsAt - s.at}`);
    assert.ok(playsAt - s.at >= 180 || k < 10, `frame ${k} lead ${playsAt - s.at}`);
  });
  assert.equal(clock.timers.size, 0, 'timer stops when the queue drains');
  // Bytes are unchanged and in order.
  assert.deepEqual(Buffer.concat(sent.map((s) => s.frame)), pcm(1000));
});

test('pacing: late timers catch up without exceeding the lead (jitter)', () => {
  const clock = fakeClock();
  const { pacer, sent } = pacerWith(clock);
  pacer.enqueue(pcm(2000));
  clock.advance(2000, { lateBy: 7 });
  clock.advance(500);
  assert.equal(sent.length, 100);
  sent.forEach((s, k) => assert.ok(k * 20 - s.at <= 200 + 1));
});

test('pacing: streamed TTS chunks join the same queue seamlessly', () => {
  const clock = fakeClock();
  const { pacer, sent } = pacerWith(clock);
  pacer.enqueue(pcm(400));
  clock.advance(100);
  pacer.enqueue(pcm(400));
  clock.advance(1000);
  assert.equal(sent.length, 40);
  assert.equal(pacer.stats().underruns, 0);
  assert.deepEqual(Buffer.concat(sent.map((s) => s.frame)), Buffer.concat([pcm(400), pcm(400)]));
});

test('pacing: a gap after the queue drains starts a fresh 200 ms lead', () => {
  const clock = fakeClock();
  const { pacer, sent } = pacerWith(clock);
  pacer.enqueue(pcm(100));
  clock.advance(3000);
  pacer.enqueue(pcm(1000));
  assert.equal(sent.length, 5 + 10);
});

test('cancel: flush drops every queued frame and nothing more is sent', () => {
  const clock = fakeClock();
  const { pacer, sent } = pacerWith(clock);
  pacer.enqueue(pcm(2000));
  clock.advance(300);
  const before = sent.length;
  const dropped = pacer.flush();
  assert.equal(dropped, 100 - before);
  assert.equal(pacer.queuedFrames(), 0);
  assert.equal(clock.timers.size, 0);
  clock.advance(2000);
  assert.equal(sent.length, before, 'no frame after cancel');
  assert.equal(pacer.stats().framesFlushed, dropped);
  // The next reply after barge-in starts immediately with a fresh lead.
  pacer.enqueue(pcm(1000));
  assert.equal(sent.length, before + 10);
});

test('pacing: a send error clears the queue and stops', () => {
  const clock = fakeClock();
  let n = 0;
  const errors = [];
  const pacer = ml.createPcmPacer({
    send: () => {
      n += 1;
      if (n === 3) throw new Error('closed');
    },
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onError: (e) => errors.push(e.message),
  });
  pacer.enqueue(pcm(1000));
  clock.advance(1000);
  assert.equal(n, 3);
  assert.deepEqual(errors, ['closed']);
  assert.equal(pacer.queuedFrames(), 0);
});

// --- server.js sendPcmToMedia / clearMediaPlayback, extracted and run with stubs.
function extract(name) {
  const start = SERVER.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = SERVER.indexOf('\n}\n', start);
  return SERVER.slice(start, end + 2);
}

function serverHarness({ paced }) {
  const clock = fakeClock();
  const WebSocket = { OPEN: 1 };
  const sent = [];
  const ws = { readyState: 1, bufferedAmount: 0, send: (d) => sent.push({ at: clock.now(), d }) };
  const MEDIA_CLOCKS = new WeakMap();
  const MEDIA_PACERS = new WeakMap();
  const MEDIA_LINKS = new WeakMap();
  const logs = [];
  MEDIA_LINKS.set(ws, ml.createMediaLinkStats({ now: clock.now, log: (m) => logs.push(m), warn: (m) => logs.push(m) }));
  if (paced) {
    MEDIA_PACERS.set(
      ws,
      ml.createPcmPacer({ send: (f) => ws.send(f, { binary: true }), now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer })
    );
  }
  const src = `${extract('sendPcmToMedia')}\n${extract('clearMediaPlayback')}\nreturn { sendPcmToMedia, clearMediaPlayback };`;
  // eslint-disable-next-line no-new-func
  const fns = new Function(
    'WebSocket', 'MEDIA_CLOCKS', 'MEDIA_PACERS', 'MEDIA_LINKS', 'mediaLink', 'applyPcmGain', 'resolveVoiceProfile', 'OUTBOUND_PCM_FRAME_BYTES', 'console',
    src
  )(WebSocket, MEDIA_CLOCKS, MEDIA_PACERS, MEDIA_LINKS, ml, (p) => p, () => ({ gain: 1 }), 640, { log: () => {}, warn: () => {} });
  return { clock, ws, sent, logs, ...fns, link: MEDIA_LINKS.get(ws) };
}

test('parity (flag off): sendPcmToMedia sends every 20 ms frame at once, as before', () => {
  const h = serverHarness({ paced: false });
  h.sendPcmToMedia(h.ws, pcm(1000));
  assert.equal(h.sent.length, 50);
  assert.ok(h.sent.every((s) => s.at === 0 && s.d.length === 640));
  assert.deepEqual(Buffer.concat(h.sent.map((s) => s.d)), pcm(1000));
  h.clearMediaPlayback(h.ws);
  assert.deepEqual(h.sent.slice(50).map((s) => JSON.parse(s.d)), [{ type: 'killAudio' }, { event: 'clear' }, { type: 'clear' }]);
});

test('flag on: sendPcmToMedia paces, and barge-in clear flushes the queue before killAudio', () => {
  const h = serverHarness({ paced: true });
  h.sendPcmToMedia(h.ws, pcm(1000));
  assert.equal(h.sent.length, 10);
  h.clock.advance(100);
  const audioSent = h.sent.length;
  h.clearMediaPlayback(h.ws);
  const after = h.sent.slice(audioSent).map((s) => JSON.parse(s.d));
  assert.deepEqual(after, [{ type: 'killAudio' }, { event: 'clear' }, { type: 'clear' }]);
  h.clock.advance(2000);
  assert.equal(h.sent.length, audioSent + 3, 'no audio after the cancel');
});

test('link stats: HD_60e56c6acc88 connect delay (answer 21:52:29.72, WS 21:52:35.66 EAT) logs slow', () => {
  const logs = [];
  const s = ml.createMediaLinkStats({ log: (m) => logs.push(['log', m]), warn: (m) => logs.push(['warn', m]), label: () => 'HD_60e56c6acc88' });
  const d = s.noteConnect({ answeredAt: Date.parse('2026-10-17T18:52:29.720Z'), connectedAt: Date.parse('2026-10-17T18:52:35.660Z') });
  assert.equal(d, 5940);
  assert.deepEqual(logs, [['warn', '[ws/media][HD_60e56c6acc88] media link connect_delay=5940ms slow (>=3000ms)']]);
  logs.length = 0;
  s.noteConnect({ answeredAt: 1000, connectedAt: 1800 });
  assert.deepEqual(logs, [['log', '[ws/media][HD_60e56c6acc88] media link connect_delay=800ms']]);
});

test('link stats: one alert per caller-audio stall over 1.5 s while open, then resumed', () => {
  const clock = fakeClock();
  const logs = [];
  const s = ml.createMediaLinkStats({ now: clock.now, log: (m) => logs.push(m), warn: (m) => logs.push(m), label: () => 'X' });
  s.noteInbound();
  clock.advance(1400);
  s.tick();
  assert.equal(logs.length, 0, '1.4 s is not a stall');
  clock.advance(200);
  s.tick();
  clock.advance(400);
  s.tick();
  assert.deepEqual(logs, ['[alert] [ws/media][X] media link caller audio stalled >1500ms while open (stall #1)']);
  clock.advance(500);
  s.noteInbound();
  assert.equal(logs[1], '[ws/media][X] media link caller audio resumed after 2500ms');
  // Not open (closing): no alert.
  clock.advance(5000);
  s.tick({ open: false });
  assert.equal(logs.length, 2);
  // Before any caller audio: no alert.
  const t = ml.createMediaLinkStats({ now: clock.now, log: (m) => logs.push(m), warn: (m) => logs.push(m) });
  clock.advance(5000);
  t.tick();
  assert.equal(logs.length, 2);
});

test('link stats: ping RTT, per-reply send buffer, close summary', () => {
  const clock = fakeClock();
  const logs = [];
  const s = ml.createMediaLinkStats({ now: clock.now, log: (m) => logs.push(m), warn: (m) => logs.push(m), label: () => 'X' });
  s.notePingSent();
  clock.advance(42);
  assert.equal(s.notePong(), 42);
  assert.equal(s.notePong(), null, 'a pong without a ping is ignored');
  s.noteSend(16000, 0);
  clock.advance(300);
  s.noteSend(16000, 12800);
  clock.advance(999);
  s.tick();
  assert.equal(logs.filter((l) => / reply /.test(l)).length, 0, 'reply still open under 1 s gap');
  clock.advance(1);
  s.tick();
  assert.ok(logs.includes('[ws/media][X] media link reply n=1 audio=1000ms sends=2 send_ms=300 max_buffered=12800B'));
  s.noteInbound();
  const line = s.summary({ code: 1006, paced: true, pacer: { framesSent: 50, framesFlushed: 4, underruns: 0 } });
  assert.equal(
    line,
    '[ws/media][X] media link summary code=1006 connect_delay=? stalls=0 max_stall=0ms rtt_ms=42/42/42(1) replies=1 max_buffered=12800B paced=on frames_sent=50 flushed=4 underruns=0'
  );
});

test('server wiring: link stats always on, pacer only with VOICE_MEDIA_PACING, flushed on clear and close', () => {
  assert.match(SERVER, /const mediaPacingOn = mediaLink\.mediaPacingEnabled\(\);\n\s+if \(mediaPacingOn\) \{\n\s+MEDIA_PACERS\.set\(/);
  assert.match(SERVER, /MEDIA_LINKS\.set\(ws, linkStats\);/);
  assert.match(SERVER, /binaryFrames \+= 1;\n\s+linkStats\.noteInbound\(\);/);
  assert.match(SERVER, /linkStats\.notePong\(\);/);
  assert.match(SERVER, /if \(link\) link\.notePingSent\(\);\n\s+ws\.ping\(\);/);
  assert.match(SERVER, /linkStats\.summary\(\{ code, paced: mediaPacingOn/);
  assert.match(SERVER, /if \(closingPacer\) closingPacer\.close\(\);/);
  assert.match(SERVER, /inboundCalls\.streamIssuedAt\(sessionCallSid\)/);
});
