'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { brainV2Enabled, brainV2Mode } = require('../src/conversation/v2/flag');
const { createLiveHandlers } = require('../src/conversation/v2/liveHandlers');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');

test('BRAIN_V2 live is off unless both flags are set', () => {
  assert.equal(brainV2Enabled({ env: {} }), false);
  assert.equal(brainV2Mode({ env: {} }), 'shadow');
  assert.equal(brainV2Enabled({ env: { BRAIN_V2: 'on' } }), true);
  assert.equal(brainV2Mode({ env: { BRAIN_V2_MODE: 'live' } }), 'live');
});

test('live handlers write through applyTools, not dry-run', async () => {
  const seen = [];
  const handlers = createLiveHandlers({
    applyTools: async (parsed) => {
      seen.push(parsed);
      return { results: [{ action: 'create_appointment', status: 'succeeded', id: 'apt_1' }] };
    },
  });
  const out = await handlers.createAppointment({ serviceName: 'Sofa cleaning', whenText: 'Friday 10am', name: 'Aisha' });
  assert.equal(out.id, 'apt_1');
  assert.equal(seen[0].appointment.serviceName, 'Sofa cleaning');
});

test('live turn speaks a services list and does not invent a booking', async () => {
  const profile = {
    id: 'tenant-1',
    businessName: 'Jirani Cleaning Services',
    agentName: 'Wanjiru',
    servicesCatalog: [
      { name: 'Deep clean, 1 bedroom', price_range: 'KSh 6,500' },
      { name: 'Sofa cleaning', price_range: 'From KSh 2,500' },
    ],
  };
  const writes = [];
  const live = createBrainV2Live({
    env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' },
    applyTools: async (parsed) => {
      writes.push(parsed);
      return { results: [] };
    },
  });
  const out = await live.run({
    text: 'which services do you offer?',
    profile,
    langLock: 'en',
  });
  assert.match(out.line, /Deep clean, one bedroom|Sofa cleaning|We offer/i);
  assert.doesNotMatch(out.line, /1 bedroom/);
  assert.equal(writes.length, 0);
});
