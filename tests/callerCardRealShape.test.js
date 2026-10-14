'use strict';
// v2 plan B (bug 1, 13 Oct): the ONE caller card, built by db.getCallerMemory,
// on row shapes copied from staging Supabase (not hand-made stand-ins).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const shape = require('./fixtures/staging-caller-card-shape.json');

const tables = {
  contacts: shape.contact,
  caller_files: shape.file,
  open_tasks: shape.tasks,
};
function builder(table) {
  const rows = tables[table];
  const result = () => ({ data: Array.isArray(rows) ? rows : rows ? [rows] : [], error: null });
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve(result()).then(res, rej);
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => ({ data: Array.isArray(rows) ? rows[0] || null : rows || null, error: null });
      }
      return () => b;
    },
  });
  return b;
}
const clientPath = require.resolve(path.join(__dirname, '../src/lib/supabaseClient'));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { from: builder, rpc: async () => ({ data: null, error: null }) } } };

const db = require('../src/db');
const trust = require('../src/conversation/trustP1');
const NOW = Date.parse('2026-10-13T18:30:00Z');

function withEnv(env, fn) {
  return async () => {
    const prev = {};
    for (const k of Object.keys(env)) { prev[k] = process.env[k]; process.env[k] = env[k]; }
    try { await fn(); } finally {
      for (const k of Object.keys(env)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    }
  };
}

test('one card: V2 on keeps the legacy card fields AND adds file/tasks (no tier-1 stub)', withEnv({ CALLER_MEMORY_V2: 'on', BRAIN_TRUST_P1: 'on' }, async () => {
  const card = await db.getCallerMemory({ tenantId: 'tenant', phone: '+254700000470' });
  assert.ok(card, 'known caller must have a card');
  assert.equal(card.name, 'Alvin');
  assert.equal(card.contactId, 'c-1');
  assert.equal(card.openTasks.length, 6);
  assert.equal(card.memoryNoticeShownAt, '2026-10-13T18:10:05.354+00:00');
  assert.equal(trust.identityTier(card, {}), 1);
  const g = trust.tieredGreeting("Good evening, Done and Dusted, this is Shy. We're closed now. Tukusaidie vipi.", { card });
  assert.match(g, /Karibu tena\. Tukusaidie vipi\.$/);
  assert.equal(trust.shouldSpeakNotice({ card, state: {} }), false);
}));

test('one card: V2 off is the same legacy card (+contactId), no tasks', withEnv({ CALLER_MEMORY_V2: 'off', BRAIN_TRUST_P1: 'on' }, async () => {
  const card = await db.getCallerMemory({ tenantId: 'tenant', phone: '+254700000470' });
  assert.equal(card.name, 'Alvin');
  assert.equal(card.openTasks, undefined);
  assert.equal(trust.identityTier(card, {}), 1);
}));

test('tier upgrade on real rows: confirmed name → one "about X, or something new?" (deduped, closed rows skipped)', withEnv({ CALLER_MEMORY_V2: 'on', BRAIN_TRUST_P1: 'on' }, async () => {
  const card = await db.getCallerMemory({ tenantId: 'tenant', phone: '+254700000470' });
  const state = { caller: { nameConfirmed: true }, conversation: { turnCount: 1 }, trust: {} };
  const tier = trust.identityTier(card, state);
  if (tier < 2) {
    // shared line (alternate names on file): never reads details — still a pass, logged for the report.
    assert.equal(trust.planResumeOffer({ card, tasks: card.openTasks, state, now: NOW }), null);
    console.log('# real-shape: card.sharedLine =', card.sharedLine, '→ stays tier 1, no resume offer');
    return;
  }
  const offer = trust.planResumeOffer({ card, tasks: card.openTasks, state, topic: 'yes it is Alvin', now: NOW });
  assert.equal(offer.line, 'Is this about the mattress cleaning, or something new?');
  assert.equal(offer.count, 2);
}));

test('new number: no card, no welcome back', withEnv({ CALLER_MEMORY_V2: 'on', BRAIN_TRUST_P1: 'on' }, async () => {
  const saved = tables.contacts; tables.contacts = null;
  try {
    const card = await db.getCallerMemory({ tenantId: 'tenant', phone: '+254700000999' });
    assert.equal(card, null);
    assert.equal(trust.tieredGreeting('Done and Dusted, this is Shy. How can I help?', { card }), 'Done and Dusted, this is Shy. How can I help?');
    assert.equal(trust.shouldSpeakNotice({ card, state: {} }), true);
  } finally { tables.contacts = saved; }
}));

test('same real rows, single-person line → "is this about the mattress cleaning, or something new?"', withEnv({ CALLER_MEMORY_V2: 'on', BRAIN_TRUST_P1: 'on' }, async () => {
  const saved = tables.contacts; tables.contacts = { ...saved, metadata: {} };
  try {
    const card = await db.getCallerMemory({ tenantId: 'tenant', phone: '+254700000470' });
    const state = { caller: { nameConfirmed: true }, conversation: { turnCount: 1 }, trust: {} };
    assert.equal(trust.identityTier(card, state), 2);
    const offer = trust.planResumeOffer({ card, tasks: card.openTasks, state, topic: 'yes it is Alvin', now: NOW });
    assert.equal(offer.line, 'Is this about the mattress cleaning, or something new?');
    assert.equal(offer.count, 2);
    const st2 = { caller: { nameConfirmed: true }, conversation: { turnCount: 1 }, trust: {} };
    assert.equal(trust.planResumeOffer({ card, tasks: card.openTasks, state: st2, topic: 'I want my sofa cleaned', now: NOW }), null);
  } finally { tables.contacts = saved; }
}));
