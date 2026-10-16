'use strict';
// #708 on the voice side: a request-mode business gets "Visit requested", never "Visit booked".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { renderOwnerMessage } = require('../src/conversation/v2/owner');
const V2 = require('../src/conversation/v2');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');
const NOW = new Date('2026-10-14T05:00:00Z');
const BOOKED = /\b(booked|confirmed|scheduled)\b/i;
const base = { businessName: 'Jirani', callerPhone: '+254790381872', name: 'Amina', intent: 'book', outcome: 'booked' };

test('owner text: request mode says Visit requested', () => {
  const t = renderOwnerMessage({ ...base, requestMode: true });
  assert.match(t, /Outcome: Visit requested\. Please call the caller back to confirm\./);
  assert.match(t, /Intent: Visit request/);
  assert.doesNotMatch(t, BOOKED);
});

test('owner text: request mode is the default; booking-for-me on keeps Visit booked', () => {
  assert.doesNotMatch(renderOwnerMessage(base), BOOKED);
  assert.match(renderOwnerMessage({ ...base, requestMode: false }), /Outcome: Visit booked\./);
});

test('finishCall for a request-mode business (Done and Dusted fixture) never says booked', async () => {
  const st = V2.createState({ profile: DD, callerPhone: '+254700000001', openRows: [], pendingTasks: [] });
  for (const text of ['Can someone call me back please?', 'Yes', 'Actually, book sofa cleaning Friday at 10am in Kitengela, I am Alvin.', 'Yes', 'No thanks']) {
    await V2.runTurn(st, { text, profile: DD, now: NOW, handlers: V2.createDryRunHandlers(), langLock: 'en' });
  }
  const fin = V2.finishCall(st, { businessName: 'DD', callerPhone: '+254700000001' });
  assert.equal(fin.outcome, 'booked'); // stored key unchanged
  assert.match(fin.ownerText, /Visit requested/);
  assert.doesNotMatch(fin.ownerText, BOOKED);
});

test('taxonomy: booking outcome label is Visit requested in both copies', () => {
  for (const f of ['src/data/taxonomy.json', 'dashboard/src/lib/taxonomy.json']) {
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
    assert.equal(t.outcomes.find((o) => o.id === 'booking').label, 'Visit requested', f);
  }
});
