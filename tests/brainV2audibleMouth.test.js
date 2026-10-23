'use strict';
// C7 audible mouth — A1–A6 + B1–B2 (no live dial). Staging tip fixtures only.
const test = require('node:test');
const assert = require('node:assert/strict');
const V2 = require('../src/conversation/v2');
const AM = require('../src/conversation/v2/audibleMouth');
const MS = require('../src/conversation/v2/modelShadow');
const { createBrainV2Live } = require('../src/conversation/v2/liveTurn');
const CS = require('../src/conversation/v2/commitSafety');
const DD = require('../evals/v2/fixtures/tenants/done_and_dusted.json');

const NOW = new Date('2026-10-14T05:00:00Z'); // Wed 08:00 EAT
const ROW = {
  id: 'apt_sofa_1',
  service_name: 'Sofa cleaning',
  status: 'requested',
  window_start: '2026-10-10T07:00:00Z',
};

function handlers() {
  const log = [];
  return {
    log,
    h: {
      createAppointment: async (a) => { log.push(['appt', a]); return { id: `apt_${log.length}` }; },
      updateAppointment: async (u) => (log.push(['upd', u]), { id: u.appointmentId }),
      createServiceRequest: async (r) => (log.push(['sr', r]), { id: 'sr_1' }),
      escalate: async (e) => (log.push(['esc', e]), { ok: true, id: 'task_1' }),
      saveCallerInfo: async () => ({ ok: true }),
      recordWriteReceipt: async () => ({ ok: true, id: 'r1' }),
      confirmCallerName: async () => ({ ok: true }),
    },
  };
}

async function turn(text, seed = {}, opts = {}) {
  const H = handlers();
  const st = V2.createState({
    profile: opts.profile || DD,
    callerPhone: '+254709221537',
    contactName: seed.contactName || null,
    openRows: seed.openRows || [],
    sharedLine: seed.sharedLine === true,
    nameConfirmed: seed.nameConfirmed === true,
    returning: seed.returning === true,
    lastVisit: seed.lastVisit || null,
    callId: opts.callId || 'HD_c7_audible',
  });
  if (seed.lang) st.lang = seed.lang;
  const model = opts.model || null;
  const out = await V2.runTurn(st, {
    text,
    profile: opts.profile || DD,
    now: opts.now || NOW,
    handlers: H.h,
    model,
    langLock: opts.langLock || 'en',
  });
  return { st, out, H };
}

// --- A1 returner + bound name ---
test('A1 returner+name: spoken line contains confirmed name (not stock-only open)', async () => {
  const { out } = await turn('Hello', {
    contactName: 'Grace',
    nameConfirmed: true,
    returning: true,
    openRows: [ROW],
  });
  assert.match(out.line, /Grace/);
  assert.match(out.line, /Welcome back|Karibu tena/i);
  assert.doesNotMatch(out.line, /^How can I help you today\?$/);
});

// --- A2 last_visit seed ---
test('A2 last_visit: recall / lookup seed speaks last job, not hollow reopen', async () => {
  const { out } = await turn('Do you remember my past booking?', {
    contactName: 'Alvin',
    nameConfirmed: true,
    returning: true,
    openRows: [ROW],
  });
  assert.match(out.line, /Sofa cleaning/i);
  assert.equal(AM.isHollowReopen(out.line), false);
});

test('A2b lookup_file proposal seeds recall speech even without NLU recall', async () => {
  const model = async () => ({
    calls: [{ name: 'lookup_file', args: { topic: 'last_visit', row_id: 'apt_sofa_1' } }],
    text: 'I see you had sofa cleaning last week, that will be 2500 bob in Westlands.',
  });
  // Vague past ask that model would lookup; force via model seed when NLU weak
  const { out, st } = await turn('What about last time?', {
    contactName: 'Alvin',
    nameConfirmed: true,
    returning: true,
    openRows: [ROW],
  }, { model });
  // Either NLU recall or lookup seed must surface the job
  assert.match(out.line, /Sofa cleaning/i);
  // A5: model plaintext (price / area invent) must not appear
  assert.doesNotMatch(out.line, /2500|Westlands|bob/i);
  assert.ok(st.trace.some((t) => t.audible === 'model_text_dropped') || !/2500/.test(out.line));
});

// --- A3 shared-line lock ---
test('A3 shared line: spoken line must not greet by household name', async () => {
  const { out } = await turn('Hello', {
    contactName: 'Grace',
    nameConfirmed: true,
    returning: true,
    sharedLine: true,
    openRows: [ROW],
  });
  assert.doesNotMatch(out.line, /\bGrace\b/);
  assert.doesNotMatch(out.line, /Welcome back/i);
});

// --- A4 unknown caller ---
test('A4 unknown: stock open only; no invented name or last job', async () => {
  const { out } = await turn('Hello', {
    contactName: null,
    nameConfirmed: false,
    returning: false,
    openRows: [],
  });
  assert.doesNotMatch(out.line, /Welcome back|Karibu tena/i);
  assert.doesNotMatch(out.line, /\b(Sofa|Carpet|Grace|Alvin)\b/i);
  // Stock greeting or intent ask — no file claim
  assert.equal(AM.bindSafeName({ nameConfirmed: false }, {}, []), null);
});

// --- A5 model text mute ---
test('A5 model plaintext never TTS’d — speakSafeLine drops it', () => {
  const tpl = 'I can see your sofa cleaning.';
  const model = 'Sure! You had sofa cleaning in Kilimani for 3,500 last Tuesday.';
  assert.equal(AM.speakSafeLine(tpl, model), tpl);
  assert.doesNotMatch(AM.speakSafeLine(tpl, model), /Kilimani|3,500|Tuesday/);
});

// --- A6 R2 hold (commitSafety fixtures stay green — smoke the gate here too) ---
test('A6 R2 hold: incomplete post-wait "Okay, so" does not confirm', withCs(async () => {
  assert.equal(CS.utteranceIncomplete('Okay, so'), true);
  const ready = CS.postWaitConfirmReady({ afterWaitHold: true }, { text: 'Okay, so' });
  assert.equal(ready.ready, false);
  assert.equal(ready.reason, 'incomplete');
  const ans = CS.readbackAnswer({ tool: 'create_booking', afterWaitHold: true }, { text: 'Okay, so', unfinished: true });
  assert.equal(ans.incomplete, true);
  assert.notEqual(ans.kind, 'yes');
}));

function withCs(fn) {
  return async () => {
    const prev = process.env.BRAIN_V2_COMMIT_SAFETY;
    const prevOwns = process.env.BRAIN_V2_OWNS_CALL;
    process.env.BRAIN_V2_COMMIT_SAFETY = '1';
    delete process.env.BRAIN_V2_OWNS_CALL;
    try { await fn(); } finally {
      if (prev === undefined) delete process.env.BRAIN_V2_COMMIT_SAFETY; else process.env.BRAIN_V2_COMMIT_SAFETY = prev;
      if (prevOwns !== undefined) process.env.BRAIN_V2_OWNS_CALL = prevOwns;
    }
  };
}

// --- B1 HD_b0a5-shaped replay ---
test('B1 HD_b0a5-shaped: past booking ask with open row → acting speech (last job)', async () => {
  const lines = [
    'Habari.',
    'Unakumbuka booking yangu?',
    'The past booking.',
  ];
  const H = handlers();
  const st = V2.createState({
    profile: DD,
    callerPhone: '+254709221537',
    contactName: 'Alvin',
    openRows: [ROW],
    nameConfirmed: true,
    returning: true,
    callId: 'HD_b0a5cd469862',
  });
  const spoken = [];
  for (const text of lines) {
    const model = async () => ({
      calls: [{ name: 'lookup_file', args: { topic: 'last_visit', row_id: 'apt_sofa_1' } }],
      text: 'Looking up your file now...',
    });
    const out = await V2.runTurn(st, { text, profile: DD, now: NOW, handlers: H.h, model, langLock: 'en' });
    spoken.push(out.line);
  }
  const recallLine = spoken.find((l) => /Sofa cleaning/i.test(l));
  assert.ok(recallLine, `expected last-job speech, got: ${JSON.stringify(spoken)}`);
  assert.equal(AM.isHollowReopen(recallLine), false);
  // No writes from read path
  assert.equal(H.log.filter((x) => x[0] === 'appt').length, 0);
});

// --- B2 score harness ---
test('B2 score: valid lookup + hollow reopen → FAIL; last job spoken → PASS', () => {
  const fail = AM.scoreAudibleActing({
    proposal: { tool: 'lookup_file', args: { topic: 'last_visit' }, valid: true },
    spokenLine: 'Ungependa tufanye nini?',
    lastJobService: 'Sofa cleaning',
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.verdict, 'consulting_only');

  const pass = AM.scoreAudibleActing({
    proposal: { tool: 'lookup_file', args: { topic: 'last_visit' }, valid: true },
    spokenLine: 'I can see your sofa cleaning.',
    lastJobService: 'Sofa cleaning',
  });
  assert.equal(pass.ok, true);
  assert.equal(pass.verdict, 'acting');
});

test('bindSafeName: staff alias and unbound mute; confirmed returner speaks', () => {
  assert.equal(AM.bindSafeName({ contactName: 'Shy', nameConfirmed: true, sharedLine: false }, {}, ['shy']), null);
  assert.equal(AM.bindSafeName({ contactName: 'Alvin', nameConfirmed: false, sharedLine: false }, {}, []), null);
  assert.equal(AM.bindSafeName({ contactName: 'Alvin', nameConfirmed: true, sharedLine: false }, {}, []), 'Alvin');
  assert.equal(
    AM.bindSafeName({ contactName: 'Alvin', nameConfirmed: true, sharedLine: false }, { name: 'Grace', nameConfirmed: true }, []),
    'Grace'
  );
});

test('live callerFile carries sharedLine / nameConfirmed / lastVisit into state', async () => {
  const live = createBrainV2Live({
    env: { BRAIN_V2: 'on', BRAIN_V2_MODE: 'live' },
    callerFile: {
      callerPhone: '+254709221537',
      contactName: 'Wanjiru',
      nameConfirmed: true,
      sharedLine: false,
      returning: true,
      openRows: [ROW],
    },
    applyTools: async () => ({ results: [] }),
    now: NOW,
  });
  const r = await live.run({ text: 'Hello', profile: DD, langLock: 'en' });
  assert.match(r.line, /Wanjiru/);
  assert.match(r.line, /Welcome back/i);
  const st = live.getState();
  assert.equal(st.file.sharedLine, false);
  assert.equal(st.file.nameConfirmed, true);
});
