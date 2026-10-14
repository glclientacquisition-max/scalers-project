const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('../src/speech/toolSmooth');

test('flags: umbrella off by default; sub-flags follow umbrella, can be forced', () => {
  assert.equal(T.toolSmoothFlags({}).any, false);
  const on = T.toolSmoothFlags({ VOICE_TOOL_SMOOTH: '1' });
  for (const k of ['trace', 'hold', 'receipt', 'prefetch', 'readback']) assert.equal(on[k], true);
  assert.equal(T.toolSmoothFlags({ VOICE_TOOL_SMOOTH: '1', VOICE_TOOL_SMOOTH_HOLD: '0' }).hold, false);
  assert.equal(T.toolSmoothFlags({ VOICE_TOOL_SMOOTH_TRACE: '1' }).trace, true);
  assert.equal(T.toolSmoothFlags({ VOICE_TOOL_SMOOTH_TRACE: '1' }).hold, false);
});
test('media clock: queued PCM plays back to back; silence is measured', () => {
  let t = 0; const c = T.createMediaClock({ now: () => t });
  c.tag('filler'); c.onSend(32000); // 1000 ms
  t = 500; c.tag('hold'); c.onSend(16000); // queued at 1000
  t = 2000; c.tag('receipt'); c.onSend(3200);
  assert.deepEqual(c.segmentsSince(0).map((s) => [s.kind, s.startMs, s.endMs]), [['filler', 0, 1000], ['hold', 1000, 1500], ['receipt', 2000, 2100]]);
  t = 2050; c.onClear(); assert.equal(c.remainingMs(), 0);
});
test('gap-fill rule: only while the tool is pending, near the end of queued audio, max HOLD_MAX', () => {
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 100, played: 0 }), true);
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 400, played: 0 }), false);
  assert.equal(T.shouldQueueHold({ toolPending: false, remainingMs: 0, played: 0 }), false);
  assert.equal(T.shouldQueueHold({ toolPending: true, remainingMs: 0, played: T.HOLD_MAX }), false);
  for (const l of ['en', 'sw', 'sheng']) for (const line of T.holdFillLines(l)) assert.ok(line.split(/\s+/).length <= 3);
});
test('scorer: worst gap per tool turn, dead air >= 1 s, stacks; non-tool turns ignored', () => {
  const r = T.scoreToolTurns([
    { tool: true, segments: [{ startMs: 0, endMs: 1000 }, { startMs: 1100, endMs: 2000 }, { startMs: 3200, endMs: 4000 }] },
    { tool: true, segments: [{ startMs: 0, endMs: 1000 }, { startMs: 1000, endMs: 2000 }], stack: true },
    { tool: false, segments: [{ startMs: 0, endMs: 1 }, { startMs: 9000, endMs: 9001 }] },
  ]);
  assert.deepEqual(r.gaps, [1200, 0]); assert.equal(r.deadAir, 1); assert.equal(r.stacks, 1); assert.equal(r.pass, false);
});
test('staging fixtures HD_513dfb2fa73f + HD_b594e7d09bbc: before fails the bar, after passes (<=250 ms p95, no dead air)', () => {
  const dir = path.join(__dirname, 'fixtures', 'tool-turns');
  const fx = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
  assert.deepEqual(fx.map((f) => f.callId).sort(), ['HD_513dfb2fa73f', 'HD_b594e7d09bbc']);
  const before = T.scoreToolTurns(fx.map((f) => T.simulateToolTurn(f, {})));
  const after = T.scoreToolTurns(fx.map((f) => T.simulateToolTurn(f, { hold: true, receipt: true })));
  assert.equal(before.pass, false); assert.ok(before.gapP95Ms > 1000); assert.equal(before.deadAir, 1);
  assert.equal(after.pass, true); assert.ok(after.gapP95Ms <= T.GAP_BAR_MS); assert.equal(after.deadAir, 0);
  // worst-case live TTS start-up (400 ms) still passes with cached receipt + holds
  const slow = T.scoreToolTurns(fx.map((f) => T.simulateToolTurn({ ...f, assume: { ...f.assume, liveTtfaMs: 400 } }, { hold: true, receipt: true })));
  assert.equal(slow.pass, true);
});
test('server.js: every tool-smooth path is behind the flags (off = byte-identical)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const mediaClock = smooth\.trace \|\| smooth\.hold \? toolSmooth\.createMediaClock\(\) : null;/);
  assert.match(src, /if \(mediaClock\) MEDIA_CLOCKS\.set\(ws, mediaClock\);/);
  assert.match(src, /if \(smooth\.hold && spoken\.kind === 'hold' && mediaClock\) \{/);
  assert.match(src, /await \(\(smooth\.receipt && playCachedReceipt\(outcomeLine\)\) \|\| speakText\(outcomeLine\)\);/);
  assert.match(src, /if \(!smooth\.prefetch\) return null;/);
  assert.match(src, /if \(smooth\.any\) \{\n\s+stopHoldFill\(\);/);
});
test('voiceScore: toolSmooth block is report-only (score unchanged)', () => {
  const { scoreTurns } = require('../src/speech/voiceScore');
  const turn = { turnIndex: 1, callerText: 'book it', stages: [{ stage: 'tool', name: 'create_service_request' }, { stage: 'tts', text: "I've saved your request." }] };
  const a = scoreTurns([turn]);
  const b = scoreTurns([{ ...turn, stages: [...turn.stages, { stage: 'audio_segments', segments: [{ kind: 'filler', startMs: 400, endMs: 1400 }, { kind: 'receipt', startMs: 3000, endMs: 4000 }] }] }]);
  assert.equal(a.score, b.score); assert.equal(b.toolSmooth.deadAir, 1); assert.equal(b.toolSmooth.gapP95Ms, 1600);
});
