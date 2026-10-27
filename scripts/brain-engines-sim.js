#!/usr/bin/env node
'use strict';
// Simulated end-to-end BRAIN_ENGINES scenarios (no telephony). Model outputs are recorded stubs.
process.env.BRAIN_V2 = '1';
process.env.BRAIN_V2_MODE = 'live';
process.env.BRAIN_V1_DRAFT = 'on';
process.env.BRAIN_V1_DRAFT_PHASE_A = 'on';
process.env.BRAIN_MODEL_LEAD = 'on';
process.env.BRAIN_ENGINES = '1';

const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { indexFieldMeta } = require('../src/conversation/provenance');
const FR = require('../tests/fixtures/dndSimTenant.json');
const { assertTurnInvariants } = require('../src/conversation/v2/engineInvariants');

const inner = FR.picks.picks;
const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
const P = { ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id };
P.teamDirectory = [{ name: 'Owner', role: 'owner', phone: '+254711000001', receives_escalation: true }];

const STUBS = {
  'HD_231f7bef3ba4': {
    'when are you free, you guys? I am flexible.': { intent: 'ask', answers: ['hours'], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false },
    'Please call me back.': { intent: 'callback', answers: [], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false },
    'Alvin.': { intent: 'confirm', answers: [], yes_no: null, slots: { name: 'Alvin' }, language: 'en', wants_human: false, closing: false },
    'Sawa. Wewe utamwambia nipigie?': { intent: 'confirm', answers: [], yes_no: 'yes', slots: {}, language: 'sw', wants_human: false, closing: false },
  },
  'HD_b0ecf17361a3': {
    'Do you come to Rongai?': { intent: 'ask', answers: ['coverage', 'price'], yes_no: null, slots: { place: 'Rongai' }, language: 'en', wants_human: false, closing: false },
    'And the fee?': { intent: 'ask', answers: ['price'], yes_no: null, slots: { place: 'Rongai' }, language: 'en', wants_human: false, closing: false },
  },
  'HD_6d4e7863db76': {
    'Habari yako, unaitwa aje?': { intent: 'ask', answers: ['identity'], yes_no: null, slots: {}, language: 'sw', wants_human: false, closing: false },
    'Ndiyo': { intent: 'confirm', answers: ['price'], yes_no: 'yes', slots: {}, language: 'sw', wants_human: false, closing: false },
  },
};

function streamFactory(scenario) {
  const map = STUBS[scenario] || {};
  return () => async ({ request }) => {
    const raw = request.contents[0].parts[0].text;
    let caller = raw;
    try {
      const j = JSON.parse(raw);
      caller = j.CALLER_SAID || raw;
    } catch { /* reply request */ }
    for (const [key, val] of Object.entries(map)) {
      if (String(caller).includes(key) || String(raw).includes(key)) {
        if (/Read ONE caller turn/.test(request.systemInstruction?.parts?.[0]?.text || '')) {
          return { text: JSON.stringify(val) };
        }
        return { text: JSON.stringify({ reply: '' }) };
      }
    }
    if (/Read ONE caller turn/.test(request.systemInstruction?.parts?.[0]?.text || '')) {
      return { text: JSON.stringify({ intent: 'unknown', answers: [], yes_no: null, slots: {}, language: 'en', wants_human: false, closing: false }) };
    }
    return { text: JSON.stringify({ reply: '' }) };
  };
}

async function runScenario(name, turns, { now = '2026-10-25T19:50:00+03:00', lang = null } = {}) {
  const transcript = [];
  const prior = [];
  const writes = [];
  const notifies = [];
  const stream = streamFactory(name);
  const live = createBrainV2Live({
    env: { ...process.env, BRAIN_ENGINES: '1', BRAIN_MODEL_LEAD: 'on', BRAIN_V1_DRAFT: 'on', BRAIN_V1_DRAFT_PHASE_A: 'on', BRAIN_V2: '1', BRAIN_V2_MODE: 'live' },
    applyTools: async (payload) => {
      if (payload.serviceRequest) writes.push(payload.serviceRequest);
      return { results: [{ action: 'create_service_request', ok: true, status: 'succeeded', id: `sim-${name}` }] };
    },
    dispatchEscalationAlert: async (args) => {
      notifies.push(args);
      return [{ channel: 'sms', role: 'teammate' }];
    },
    modelLeadStreamFor: stream,
    v1DraftStreamFor: stream,
    prewarm: false,
    now: () => new Date(now),
    callSid: name,
    callerFile: { callerPhone: '+254790381872', contactName: null, openRows: [] },
    log: () => {},
  });
  for (const t of turns) {
    const r = await live.run({ text: t, profile: P, langLock: lang });
    const line = r.line || '';
    transcript.push({ caller: t, agent: line, path: r.path });
    const issues = assertTurnInvariants({ line, lang: r.lang || lang || 'en', prior: prior.map((x) => x.agent) });
    if (issues.length) transcript.push({ invariant_fail: issues.join(',') });
    prior.push(transcript[transcript.length - 1]);
  }
  if (writes.length || notifies.length) {
    transcript.push({ writes: writes.length, notifies: notifies.length });
  }
  return transcript;
}

async function main() {
  const out = {};
  out.HD_231f7bef3ba4 = await runScenario('HD_231f7bef3ba4', [
    'when are you free, you guys? I am flexible.',
    'Please call me back.',
    'Alvin.',
    'Sawa. Wewe utamwambia nipigie?',
  ], { now: '2026-10-25T19:50:00+03:00', lang: null });
  out.HD_b0ecf17361a3 = await runScenario('HD_b0ecf17361a3', ['Do you come to Rongai?', 'And the fee?'], { now: '2026-10-25T10:00:00+03:00', lang: 'en' });
  out.HD_6d4e7863db76 = await runScenario('HD_6d4e7863db76', ['Habari yako, unaitwa aje?', 'Ndiyo'], { now: '2026-10-25T14:25:00+03:00', lang: 'sw' });
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
