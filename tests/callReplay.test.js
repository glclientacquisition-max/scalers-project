// Replay the staging and production turns that went silent or spoke over the caller.
// Caller lines and the old written/spoken counts are from those calls.
// Gemini text is the reply that reproduced the drop.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runSpokenReplyPipeline } = require('../src/speech/spokenReplyPipeline');
const { looksIncomplete, decideTurnEnd, LATENCY_BUDGET } = require('../src/speech/turnEndPolicy');
const { planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');
const { canned } = require('../src/speech/languages');

const MIN_RATIO = 0.5;
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'calls');

function chars(text) {
  return String(text || '').trim().length;
}

function loadCalls() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')));
}

describe('call replay', () => {
  const calls = loadCalls();
  const required = [
    'HD_fe0d1e8fbd6e',
    'HD_053dd373ee84',
    'HD_f32a2b7caafd',
    'HD_b47644d19072',
    'HD_21b92f25640b',
  ];
  it('covers the five live calls', () => {
    const ids = calls.map((call) => call.callSid);
    for (const id of required) assert.ok(ids.includes(id), id);
  });

  for (const call of calls) {
    it(call.callSid, () => {
      for (const [index, turn] of call.turns.entries()) {
        const label = `${call.callSid}#${index}`;
        if (turn.incomplete != null) {
          assert.equal(looksIncomplete(turn.caller), turn.incomplete, label);
        }
        if (turn.holdReason) {
          const decision = decideTurnEnd({ event: 'endpoint', text: turn.caller });
          assert.equal(decision.action, 'hold', label);
          assert.equal(decision.reason, turn.holdReason, label);
          assert.ok(decision.waitMs <= LATENCY_BUDGET.maxWaitMs, label);
          assert.ok(decision.waitMs >= LATENCY_BUDGET.minWaitMs, label);
        }
        if (turn.completeFlush) {
          const decision = decideTurnEnd({ event: 'endpoint', text: turn.caller });
          assert.equal(decision.action, 'flush', label);
          assert.equal(looksIncomplete(turn.caller), false, label);
        }
        if (turn.emptyGemini) {
          const planned = planEmptyGeminiSpeech({
            language: call.language,
            userText: turn.caller,
            llmDown: false,
            modelMissed: Boolean(turn.modelMissed),
          });
          assert.equal(planned.speak, true, label);
          assert.equal(planned.kind, turn.expectKind, label);
          assert.equal(planned.line, turn.expectLine, label);
          assert.notEqual(planned.line, 'Samahani, sema tena?');
          if (!turn.modelMissed) assert.doesNotMatch(planned.line, /sema tena|say that again/i);
        }
        if (turn.nameAsk) {
          assert.equal(canned(call.language, 'nameAsk', { name: turn.nameAsk }), turn.expectNameAsk);
        }
        if (turn.gemini == null) continue;
        const spoken = runSpokenReplyPipeline(turn.gemini, {
          callerTurns: [turn.caller],
          state: { conversation: { answersReceived: [turn.caller] } },
          profile: { businessName: turn.businessName || 'Chapter One', servicesCatalog: [] },
          language: call.language,
          toolResults: [],
          capabilities: {},
        });
        const said = spoken.text;
        const ratio = chars(said) / Math.max(chars(turn.gemini), 1);
        const minRatio = turn.minRatio != null ? turn.minRatio : MIN_RATIO;
        assert.ok(ratio + 1e-9 >= minRatio, `${label} ratio ${ratio.toFixed(2)} spoken="${said}"`);
        if (turn.wasSpokenChars != null) {
          assert.ok(chars(said) > turn.wasSpokenChars, `${label} still at the old spoken length`);
        }
        for (const bit of turn.mustInclude || []) {
          assert.match(said, new RegExp(bit, 'i'), `${label} missing ${bit}`);
        }
        if (turn.mustNotEqual) assert.notEqual(said, turn.mustNotEqual, label);
      }
    });
  }
});
