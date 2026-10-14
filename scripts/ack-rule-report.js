#!/usr/bin/env node
// Ack-led % before/after VOICE_ACK_RULE on the seeded call replays (heard = filler + TTS).
// Report-only; does not touch the baseline.
delete process.env.FACT_HASH_MODE;
const fs = require('fs');
const path = require('path');
const { replayCall } = require('../src/speech/replayVoice');
const A = require('../src/speech/ackRule');
const DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'voice-calls');
const rows = (t, n) => (t?.stages || []).filter((r) => r.stage === n);
const fillerOf = (t) => (rows(t, 'filler')[0]?.text) || (rows(t, 'tts').find((r) => r.filler)?.text) || '';
const textOf = (t) => rows(t, 'tts').filter((r) => !r.filler).map((r) => String(r.text || '').trim()).filter(Boolean).join(' ');
(async () => {
  const before = []; const after = []; const perCall = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const rep = await replayCall(fx, { mode: 'recorded' });
    const turns = rep.turns || rep.trace?.turns || [];
    const tr = A.createAckTracker(); const b = []; const a = [];
    turns.forEach((t, i) => {
      const filler = String(fillerOf(t)).trim(); const text = textOf(t);
      b.push({ filler, text });
      tr.beginTurn({ callerText: fx.turns?.[i]?.caller || '' });
      const tool = rows(t, 'tool').length > 0;
      let f2 = '';
      if (filler) { const p = A.pickRuleFiller({ lang: /^(mm|sawa|haya|poa)/i.test(filler) ? 'sw' : 'en', toolTurn: tool, tracker: tr }); f2 = p.text; tr.noteHeard(f2); }
      const t2 = A.applyAckBackstop(text, { tracker: tr, acked: A.isAckLed(f2) }); tr.noteHeard(t2);
      a.push({ filler: f2, text: t2 });
    });
    const sb = A.scoreAckRule(b); const sa = A.scoreAckRule(a);
    perCall.push({ call: fx.callId, before: sb.ackLedPct, after: sa.ackLedPct, stacksBefore: sb.stacks, stacksAfter: sa.stacks });
    before.push(...b.map((x) => ({ ...x, _c: f }))); after.push(...a);
  }
  // pooled: score per call already resets runs; pool counts
  const pool = (arr) => A.scoreAckRule(arr);
  console.log(JSON.stringify({ perCall, before: pool(before), after: pool(after) }, null, 1));
})();
