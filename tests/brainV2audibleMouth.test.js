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
  // Acting = job label spoken. welcome_back template also contains "which service do you need"
  // (HOLLOW_REOPEN token) when rulesMouthSeed combines welcome + last job — job token wins.
  assert.equal(
    AM.scoreAudibleActing({
      proposal: { tool: 'lookup_file', args: { topic: 'last_visit' }, valid: true },
      spokenLine: recallLine,
      lastJobService: 'Sofa cleaning',
    }).ok,
    true
  );
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
  // B2: every turn is the engines; the engines' "Hello" reply does not use the caller file's name (a known engines gap,
  // listed in the B2 PR). The file still reaches state.
  const r = await live.run({ text: 'Hello', profile: DD, langLock: 'en' });
  assert.ok(typeof r.line === 'string' && r.line.length > 0, 'a line is spoken');
  const st = live.getState();
  assert.equal(st.file.sharedLine, false);
  assert.equal(st.file.nameConfirmed, true);
});


// --- Prompt acceptance A1–A5: mouth seed WITHOUT model (forced timeout) ---
test('A1 seed: confirmed+not shared → name spoken with model always timedOut', async () => {
  const model = async () => { await new Promise((r) => setTimeout(r, 50)); return { calls: [], timedOut: true }; };
  const { out } = await turn('Hello', {
    contactName: 'Alvin',
    nameConfirmed: true,
    returning: true,
    openRows: [ROW],
  }, { model });
  assert.match(out.line, /Alvin/);
  assert.match(out.line, /Welcome back|Karibu tena/i);
  const score = AM.scoreRulesMouthSeed({
    spokenLine: out.line, name: 'Alvin', lastJobService: 'Sofa cleaning',
    modelTimedOut: true, nameConfirmed: true, sharedLine: false,
  });
  assert.equal(score.ok, true, JSON.stringify(score));
});

test('A2 seed: openRows/job label spoken with NO model proposal (D199 job field)', async () => {
  // D199 card shape: job, not service/service_name — rulesMouthSeed must alias.
  const { out, st } = await turn('Hello', {
    contactName: 'Alvin',
    nameConfirmed: true,
    returning: true,
    openRows: [{ id: 'apt_carpet', job: 'Carpet cleaning', status: 'requested', window_start: '2026-10-10T07:00:00Z' }],
  }, { model: null });
  assert.match(out.line, /Carpet cleaning/i);
  assert.equal(st.fileSeeded, true);
  assert.equal(AM.lastJobRow({ openRows: [{ job: 'Carpet cleaning', status: 'requested' }] }).service, 'Carpet cleaning');
});

test('A3 seed: name_confirmed=false → no name greet (DnD-shaped)', async () => {
  const { out } = await turn('Hello', {
    contactName: 'Alvin',
    nameConfirmed: false,
    returning: true,
    openRows: [ROW],
  });
  // Confirm ask may cite the on-file name; named welcome-back must not.
  assert.doesNotMatch(out.line, /Welcome back,\s*Alvin|Karibu tena,\s*Alvin/i);
  assert.equal(AM.bindSafeName({ contactName: 'Alvin', nameConfirmed: false, sharedLine: false }, {}, []), null);
  const card = AM.bindSafeOpeningCard(
    { contactName: 'Alvin', nameConfirmed: false, sharedLine: false, returning: true, openRows: [ROW] },
    {},
    []
  );
  assert.equal(card.nameConfirmed, false);
  assert.equal(card.knownName, 'Alvin'); // on file but not confirmed for TTS name greet
});

test('A3b DnD unconfirmed → confirm ask once (B1 criteria), not invent confirm', async () => {
  const { out, st } = await turn('Hello', {
    contactName: 'Alvin',
    nameConfirmed: false,
    returning: true,
    openRows: [ROW],
  });
  assert.match(out.line, /Am I speaking with Alvin|Je, naongea na Alvin/i);
  assert.equal(st.nameConfirmAsked, true);
  assert.equal(st.file.nameConfirmed, false); // never invent
  assert.equal(st.expecting, 'name_confirm');
});

test('A4 seed: shared line → no household name greet', async () => {
  const { out } = await turn('Hello', {
    contactName: 'Grace',
    nameConfirmed: true,
    returning: true,
    sharedLine: true,
    openRows: [ROW],
  });
  assert.doesNotMatch(out.line, /\bGrace\b/);
  assert.doesNotMatch(out.line, /Welcome back/i);
  assert.equal(AM.needsNameConfirm({ contactName: 'Grace', sharedLine: true, nameConfirmed: false }, {}), false);
});

test('A5 seed: model plaintext still never TTS’d', async () => {
  const model = async () => ({
    calls: [],
    text: 'Sure Alvin your carpet in Kilimani is 4500 bob',
  });
  const { out } = await turn('Hello', {
    contactName: 'Alvin',
    nameConfirmed: true,
    returning: true,
    openRows: [{ id: '1', job: 'Carpet cleaning', status: 'requested' }],
  }, { model });
  assert.doesNotMatch(out.line, /Kilimani|4500|bob/i);
  assert.equal(AM.speakSafeLine('I can see your carpet cleaning.', 'Kilimani 4500'), 'I can see your carpet cleaning.');
});

// --- B2/B3 per-tenant confirm ---
test('B2 confirm yes on this tenant only → later greet by name; other tenant flag unchanged', async () => {
  const confirms = [];
  const H = handlers();
  H.h.confirmCallerName = async (a) => { confirms.push(a); return { ok: true }; };
  const st = V2.createState({
    profile: DD,
    callerPhone: '+254709221537',
    contactName: 'Alvin',
    openRows: [ROW],
    nameConfirmed: false,
    returning: true,
    callId: 'HD_dnd_confirm',
  });
  // Other tenant's flag stays in a separate fixture object — never copied.
  const jiraniFlag = { nameConfirmed: true, tenant: 'jirani' };
  const t1 = await V2.runTurn(st, { text: 'Hello', profile: DD, now: NOW, handlers: H.h, langLock: 'en' });
  assert.match(t1.line, /Am I speaking with Alvin/i);
  assert.equal(st.file.nameConfirmed, false);
  const t2 = await V2.runTurn(st, { text: 'Yes', profile: DD, now: NOW, handlers: H.h, langLock: 'en' });
  assert.equal(st.file.nameConfirmed, true);
  assert.equal(st.slots.nameConfirmed, true);
  assert.match(t2.line, /Alvin/);
  assert.match(t2.line, /Welcome back|Karibu tena|Sofa cleaning/i);
  assert.equal(jiraniFlag.nameConfirmed, true); // untouched
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].source, 'name_confirm_yes');
});

test('B3 never invent confirm / never copy Jirani flag onto DnD', () => {
  const dnd = { contactName: 'Alvin', nameConfirmed: false, sharedLine: false, returning: true };
  const jirani = { contactName: 'Alvin', nameConfirmed: true };
  // Applying confirm requires explicit yes on THIS state — no cross-copy helper exists.
  const st = { file: { ...dnd }, slots: {} };
  const no = AM.applyTenantConfirm(st, { yes: false });
  assert.equal(no.ok, false);
  assert.equal(st.file.nameConfirmed, false);
  // Invented name rejected
  const bad = AM.applyTenantConfirm({ file: { ...dnd }, slots: {} }, { yes: true, name: 'Invented' });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'name_mismatch');
  const card = AM.bindSafeOpeningCard(dnd, {}, []);
  assert.equal(card.nameConfirmed, false);
  void jirani;
});

test('opening card field names locked for Voice (knownName/nameConfirmed/isReturning/lastLanguage/sharedLine/openRows)', () => {
  const card = AM.bindSafeOpeningCard({
    contactName: 'Alvin',
    nameConfirmed: true,
    sharedLine: false,
    returning: true,
    openRows: [{ id: '1', job: 'Sofa cleaning', status: 'requested' }],
    lastVisit: null,
  }, {}, [], { lastLanguage: 'en' });
  for (const k of ['knownName', 'nameConfirmed', 'isReturning', 'lastLanguage', 'sharedLine', 'openRows']) {
    assert.ok(k in card, k);
  }
  assert.equal(card.knownName, 'Alvin');
  assert.equal(card.nameConfirmed, true);
  assert.equal(card.isReturning, true);
  assert.equal(card.lastLanguage, 'en');
  assert.equal(card.sharedLine, false);
});
