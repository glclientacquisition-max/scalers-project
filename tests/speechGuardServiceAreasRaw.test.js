'use strict';

// PR5 (#817) put the raw tenants.service_areas blob on the profile for lookup().
// The place check must not bind to that blob's JSON keys: "anywhere_kenya": false
// would otherwise free "Kenya" as a listed service place.

const test = require('node:test');
const assert = require('node:assert/strict');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { tenantProfileFromRow } = require('../src/tenantProfile');

function ctx(profile, callerTurns) {
  return {
    callerTurns,
    profile,
    toolResults: [],
    capabilities: {},
    state: { caller: {}, conversation: { answersReceived: [], turnCount: 2 } },
    language: 'en',
    allowEmpty: true,
    dropReasons: [],
  };
}

function quiet(fn) {
  const { log, warn } = console;
  console.log = console.warn = () => {};
  try {
    return fn();
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

const ROW = {
  id: 't1',
  business_name: 'QA Shop',
  service_areas: {
    version: 1,
    areas: [{ id: 'place:kilimani', fee_mode: 'fixed', fee_ksh: 300, confirmed: true, source: 'owner', modes: ['visit'] }],
    anywhere_kenya: false,
  },
};

test('raw service_areas stays on the profile for lookup()', () => {
  const p = tenantProfileFromRow(ROW);
  assert.equal(p.service_areas.anywhere_kenya, false);
});

test('a place named only by a service_areas JSON key still drops as unbound_place', () => {
  const p = tenantProfileFromRow(ROW);
  const c = ctx(p, ['Hello, do you deliver?']);
  const out = quiet(() => guardSpokenReply('We deliver anywhere in Kenya. How can I help?', c));
  assert.doesNotMatch(out, /Kenya/);
  assert.ok(c.dropReasons.includes('unbound_place'), String(c.dropReasons));
});
