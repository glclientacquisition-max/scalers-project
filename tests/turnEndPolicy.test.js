// One turn-end policy: endpoint, language tails, bounded wait.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  LATENCY_BUDGET,
  looksIncomplete,
  decideTurnEnd,
  incompleteWaitMs,
} = require('../src/speech/turnEndPolicy');

describe('turn end policy', () => {
  it('holds a trailing comma, dash, and Kiswahili tails', () => {
    assert.equal(looksIncomplete('Ah, nilikuwa nauliza,'), true);
    assert.equal(looksIncomplete('nilikuwa'), true);
    assert.equal(looksIncomplete('nauliza'), true);
    assert.equal(looksIncomplete('Hii ni Aris Specialist—'), true);
    assert.equal(looksIncomplete('Niambie, like, the services you offer—'), true);
    const comma = decideTurnEnd({ event: 'endpoint', text: 'Ah, nilikuwa nauliza,' });
    assert.equal(comma.action, 'hold');
    assert.equal(comma.reason, 'trailing_comma');
    assert.ok(comma.waitMs <= LATENCY_BUDGET.maxWaitMs);
    assert.ok(comma.waitMs >= LATENCY_BUDGET.minWaitMs);
    const dash = decideTurnEnd({ event: 'endpoint', text: 'Hii ni Aris Specialist—' });
    assert.equal(dash.reason, 'trailing_dash');
  });

  it('flushes a finished sentence that only has an internal comma', () => {
    assert.equal(looksIncomplete('Sawa, nimehifadhi ombi lako.'), false);
    assert.equal(looksIncomplete('I need a plumber.'), false);
    const done = decideTurnEnd({ event: 'endpoint', text: 'Sawa, nimehifadhi ombi lako.' });
    assert.equal(done.action, 'flush');
    assert.equal(done.reason, 'complete');
  });

  it('flushes immediately when the session is finished, even if the tail is open', () => {
    const finished = decideTurnEnd({ event: 'finished', text: 'Ah, nilikuwa nauliza,' });
    assert.equal(finished.action, 'flush');
    assert.equal(finished.waitMs, 0);
    assert.equal(finished.reason, 'session_finished');
    assert.equal(finished.incomplete, true);
  });

  it('caps the incomplete wait at the latency budget', () => {
    const wait = incompleteWaitMs({ baseMs: 700, minMs: 300, maxMs: 1200 });
    assert.equal(wait, 1150);
    const clamped = incompleteWaitMs({ baseMs: 900, minMs: 300, maxMs: 1200 });
    assert.equal(clamped, 1200);
    assert.equal(LATENCY_BUDGET.incompleteExtraMs, 450);
    assert.equal(LATENCY_BUDGET.sonioxEndpointMs, 700);
  });
});
