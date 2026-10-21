'use strict';

// VOICE_OPENING_V2 (src/speech/callOpening.js): templates, banned content,
// language policy and the per-callSid state machine. Pure: no server, no
// network. The server.js path is covered by tests/openingV2E2e.test.js.
//
// Snapshots: tests/fixtures/callOpening.snapshots.json. Regenerate with
//   UPDATE_OPENING_SNAPSHOTS=1 node --test tests/callOpening.test.js
// and review the diff line by line: every string is what a caller hears.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const op = require('../src/speech/callOpening');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { analyzeCallerLanguage } = require('../src/conversation/language');
const { TENANTS } = require('./fixtures/openingTenants');

const SNAP = path.join(__dirname, 'fixtures', 'callOpening.snapshots.json');

function profileOf(key, overrides = {}) {
  return { ...tenantProfileFromRow(TENANTS[key]), ...overrides };
}

/** The opening a call speaks for this tenant/language/state. */
function render(key, { lang, isOpen, returning = false, named = false, skipNotice = false }) {
  // English shop: the language is typed (future tenants.greeting_language)
  // and the owner's invite is the stock English one, so nothing mixes.
  const profile = profileOf(key, lang === 'en' ? { greetingLanguage: 'en', greetingInvite: '' } : {});
  const language = op.shopLanguage(profile);
  const card = returning
    ? { name: 'Alvin', fileOwnerName: 'Alvin', sharedLine: false, nameConfirmed: named }
    : null;
  return op.composeOpening({
    businessName: profile.businessName,
    spokenName: profile.spokenName,
    agentName: profile.agentName,
    greetingInvite: profile.greetingInvite,
    language,
    isOpen,
    afterHoursMode: 'serve',
    recordingNotice: true,
    returningSkipNotice: skipNotice,
    ...op.callerOpeningFacts(card),
  });
}

function matrix() {
  const out = {};
  for (const key of Object.keys(TENANTS)) {
    for (const lang of ['sw', 'en']) {
      for (const open of [true, false]) {
        // returning_skip: VOICE_RETURNING_SKIP_NOTICE=on (default off: returning callers hear it).
        for (const who of ['new', 'returning', 'returning_named', 'returning_skip']) {
          const r = render(key, {
            lang,
            isOpen: open,
            returning: who !== 'new',
            named: who === 'returning_named',
            skipNotice: who === 'returning_skip',
          });
          out[`${key}.${lang}.${open ? 'open' : 'closed'}.${who}`] = r.text;
        }
      }
    }
  }
  return out;
}

describe('opening snapshots per tenant (Aris, Esga, Jirani; sw/en; open/closed; returning, notice skip)', () => {
  const got = matrix();
  if (process.env.UPDATE_OPENING_SNAPSHOTS === '1') {
    fs.writeFileSync(SNAP, `${JSON.stringify(got, null, 2)}\n`);
  }
  const want = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  it('covers 48 cases', () => {
    assert.equal(Object.keys(want).length, 48);
    assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  });
  for (const k of Object.keys(want)) {
    it(k, () => assert.equal(got[k], want[k]));
  }
  it('is deterministic (no randomness, no clock)', () => {
    assert.deepEqual(matrix(), got);
  });
});

describe('wording rules', () => {
  it('Swahili shop: the whole opening is Swahili, notice translated, owner invite kept word for word', () => {
    const r = render('jirani', { lang: 'sw', isOpen: true });
    assert.equal(r.language, 'sw');
    assert.equal(
      r.text,
      'Hapa ni Jirani Cleaning Services, naitwa Wanjiru. Simu hii inaweza kurekodiwa. Nikusaidie vipi?'
    );
    assert.doesNotMatch(r.text, /This call may be recorded|Good (morning|evening)/);
  });
  it('the owner invite is spoken as written (Aris "Tukusaidie vipi" not "Nikusaidie")', () => {
    assert.match(render('aris', { lang: 'sw', isOpen: true }).text, /Tukusaidie vipi\?$/);
  });
  it('no daypart word (it changed the cache key and was inconsistent)', () => {
    for (const text of Object.values(matrix())) assert.doesNotMatch(text, /good (morning|afternoon|evening)|habari za/i);
  });
  it('returning callers: Karibu tena / Welcome back, and the notice (VOICE_RETURNING_SKIP_NOTICE off)', () => {
    const sw = render('esga', { lang: 'sw', isOpen: true, returning: true });
    assert.equal(sw.text, 'Hapa ni Esga, naitwa Lucy. Karibu tena. Simu hii inaweza kurekodiwa. Nikusaidie vipi?');
    assert.equal(sw.notice, true);
    const en = render('esga', { lang: 'en', isOpen: true, returning: true });
    assert.equal(en.text, 'Esga, this is Lucy. Welcome back. This call may be recorded. How can I help?');
  });
  it('VOICE_RETURNING_SKIP_NOTICE=on: returning callers skip it; new callers never do', () => {
    const back = render('esga', { lang: 'sw', isOpen: true, returning: true, skipNotice: true });
    assert.equal(back.text, 'Hapa ni Esga, naitwa Lucy. Karibu tena. Nikusaidie vipi?');
    assert.equal(back.notice, false);
    assert.equal(back.noticeEnd, null);
    assert.equal(render('esga', { lang: 'sw', isOpen: true, skipNotice: true }).notice, true);
    const prev = process.env.VOICE_RETURNING_SKIP_NOTICE;
    try {
      delete process.env.VOICE_RETURNING_SKIP_NOTICE;
      assert.equal(op.returningSkipNoticeOn(), false, 'default off');
      process.env.VOICE_RETURNING_SKIP_NOTICE = 'on';
      assert.equal(op.returningSkipNoticeOn(), true);
    } finally {
      if (prev == null) delete process.env.VOICE_RETURNING_SKIP_NOTICE;
      else process.env.VOICE_RETURNING_SKIP_NOTICE = prev;
    }
  });
  it('noticeEnd points just past the notice in the line', () => {
    const o = render('jirani', { lang: 'sw', isOpen: true });
    assert.equal(o.text.slice(0, o.noticeEnd).endsWith('Simu hii inaweza kurekodiwa.'), true);
    assert.equal(o.noticeText, 'Simu hii inaweza kurekodiwa.');
  });
  it('the name is spoken only when it was confirmed on an earlier call', () => {
    assert.doesNotMatch(render('aris', { lang: 'sw', isOpen: true, returning: true }).text, /Alvin/);
    assert.match(render('aris', { lang: 'sw', isOpen: true, returning: true, named: true }).text, /Karibu tena, Alvin\./);
    // A shared line never speaks a name, even a confirmed one.
    const shared = op.callerOpeningFacts({ name: 'Alvin', sharedLine: true, nameConfirmed: true });
    assert.equal(shared.nameConfirmed, false);
    // Today nothing persists name_confirmed, so a plain card never names.
    assert.equal(op.callerOpeningFacts({ name: 'Alvin' }).nameConfirmed, false);
  });
  it('closed: one closed clause in the shop language, then the invite', () => {
    assert.equal(
      render('jirani', { lang: 'sw', isOpen: false }).text,
      'Hapa ni Jirani Cleaning Services, naitwa Wanjiru. Simu hii inaweza kurekodiwa. Tumefunga kwa sasa, lakini bado naweza kuchukua ombi lako. Nikusaidie vipi?'
    );
  });
  it('message mode asks for the name in the shop language and never says a file name', () => {
    const r = op.composeOpening({ businessName: 'Esga', agentName: 'Lucy', greetingInvite: 'Nikusaidie vipi', language: 'sw', afterHoursMode: 'message', recordingNotice: false, isOpen: false });
    assert.equal(r.text, 'Hapa ni Esga, naitwa Lucy. Tumefunga kwa sasa. Naweza kuchukua ujumbe. Naomba jina lako?');
  });
  it('owner bulletin closure is spoken verbatim', () => {
    const r = op.composeOpening({ businessName: 'Esga', agentName: 'Lucy', greetingInvite: 'Nikusaidie vipi', language: 'sw', closureNotice: 'Tumefunga leo kwa sikukuu', recordingNotice: false });
    assert.equal(r.text, 'Hapa ni Esga, naitwa Lucy. Tumefunga leo kwa sikukuu. Nikusaidie vipi?');
  });
  it('a future owner greeting_text is used verbatim, plus the notice', () => {
    const r = op.composeOpening({ businessName: 'Esga', agentName: 'Lucy', greetingText: 'Karibu Esga, mimi ni Lucy. Nikusaidie vipi?', language: 'sw', recordingNotice: true });
    assert.equal(r.text, 'Karibu Esga, mimi ni Lucy. Nikusaidie vipi? Simu hii inaweza kurekodiwa.');
  });
  it('the default persona "Receptionist" is not spoken', () => {
    const r = op.composeOpening({ businessName: 'Esga', agentName: 'Receptionist', language: 'en', recordingNotice: false });
    assert.equal(r.text, 'Esga. How can I help?');
  });
  it('shop language comes from the owner words (sw invite -> sw), typed field wins', () => {
    assert.equal(op.shopLanguage(profileOf('aris')), 'sw');
    assert.equal(op.shopLanguage(profileOf('aris', { greetingLanguage: 'en' })), 'en');
    assert.equal(op.shopLanguage({ greetingInvite: 'How can we help you today?' }), 'en');
    assert.equal(op.shopLanguage({}), 'en');
  });
});

describe('banned content', () => {
  const all = matrix();
  for (const key of Object.keys(TENANTS)) {
    const profile = profileOf(key);
    const shop = op.shopLabel(profile);
    const staff = op.staffNames(profile);
    it(`${key}: shop name present, no language invite, no staff-directory names`, () => {
      assert.ok(staff.length > 0, 'fixture has staff names');
      for (const [k, text] of Object.entries(all)) {
        if (!k.startsWith(`${key}.`)) continue;
        const check = op.checkOpeningLine(text, { shopName: shop, staff, agentName: profile.agentName });
        assert.deepEqual(check.problems, [], `${k}: ${text}`);
        assert.ok(text.includes(shop), `${k}: shop name`);
        assert.doesNotMatch(text, /english or kiswahili|kiingereza au kiswahili/i, k);
        for (const n of staff) assert.doesNotMatch(text, new RegExp(`\\b${n}\\b`), `${k}: staff ${n}`);
      }
    });
  }
  it('the checker catches each problem', () => {
    assert.deepEqual(
      op.checkOpeningLine('Hapa ni Esga. You can speak in English or Kiswahili. Chris will help.', { shopName: 'Esga', staff: ['Chris'] }).problems,
      ['language_invite', 'staff_name:Chris']
    );
    assert.deepEqual(op.checkOpeningLine('Hello, how can I help?', { shopName: 'Esga' }).problems, ['shop_name_missing']);
  });
  it('the bare-Hello, silence and goodbye lines carry no invite and no persona re-introduction', () => {
    for (const language of ['sw', 'en']) {
      const invite = op.PACK[language].invite;
      for (let c = 0; c < op.MAX_BARE_HELLO; c += 1) {
        const line = op.bareHelloLine({ language, invite, count: c });
        assert.doesNotMatch(line, /english or kiswahili|this is|naitwa|mimi ni/i);
      }
      for (let s = 1; s <= 3; s += 1) assert.doesNotMatch(op.silenceLine({ language, invite, step: s }), /english or kiswahili/i);
    }
  });
});

describe('lines', () => {
  it('bare Hello re-invites: 2 forms per language, owner invite at the end', () => {
    assert.equal(op.bareHelloLine({ language: 'sw', invite: 'Tukusaidie vipi?', count: 0 }), 'Ndiyo, niko hapa. Tukusaidie vipi?');
    assert.equal(op.bareHelloLine({ language: 'sw', invite: 'Tukusaidie vipi?', count: 1 }), 'Nakusikia. Tukusaidie vipi?');
    assert.equal(op.bareHelloLine({ language: 'en', invite: 'How can I help?', count: 0 }), "Yes, I'm here. How can I help?");
  });
  it('silence ladder lines: invite, Hello? invite, goodbye', () => {
    assert.equal(op.silenceLine({ language: 'sw', invite: 'Nikusaidie vipi?', step: 1 }), 'Nikusaidie vipi?');
    assert.equal(op.silenceLine({ language: 'sw', invite: 'Nikusaidie vipi?', step: 2 }), 'Halo? Nikusaidie vipi?');
    assert.match(op.silenceLine({ language: 'sw', step: 3 }), /Kwaheri\.$/);
    assert.match(op.silenceLine({ language: 'en', step: 3 }), /Goodbye\.$/);
  });
  it('warm lines: first, returning, 2 re-invites, 3 ladder lines (cacheable, no names)', () => {
    const lines = op.openingWarmLines(profileOf('jirani'), { isOpen: true, recordingNotice: true });
    assert.equal(lines.length, 7);
    for (const l of lines) assert.doesNotMatch(l, /Alvin/);
    assert.ok(lines.includes('Hapa ni Jirani Cleaning Services, naitwa Wanjiru. Simu hii inaweza kurekodiwa. Nikusaidie vipi?'));
  });
});

describe('barge-in over the greeting', () => {
  it('a real word barges at once', () => {
    assert.deepEqual(op.decideGreetingBarge({ text: 'Mnafanya carpet cleaning?', speechMs: 0 }), { barge: true, reason: 'real_word' });
    assert.equal(op.decideGreetingBarge({ text: 'Bei', speechMs: 100 }).barge, true);
  });
  it('fillers and a bare hello wait, until 600 ms of speech', () => {
    for (const t of ['mm', 'Hello?', 'eeh', 'okay', 'Ndiyo']) {
      assert.equal(op.decideGreetingBarge({ text: t, speechMs: 300 }).barge, false, t);
    }
    assert.deepEqual(op.decideGreetingBarge({ text: 'Hello hello hello', speechMs: 650 }), { barge: true, reason: 'speech_ms' });
    assert.equal(op.decideGreetingBarge({ text: 'mm', speechMs: 599 }).barge, false);
  });
  it('speech span comes from token timing', () => {
    assert.equal(op.speechSpanMs([{ start_ms: 100, end_ms: 300 }, { start_ms: 320, end_ms: 760 }]), 660);
    assert.equal(op.speechSpanMs([]), 0);
  });
});

describe('language policy', () => {
  const ev = (t) => analyzeCallerLanguage(t);
  it('starts in the shop language', () => {
    assert.equal(op.initialLanguageState('sw').current, 'sw');
  });
  it('a new caller switches on the first clear turn', () => {
    const s = op.resolveOpeningLanguage(op.initialLanguageState('sw'), ev('Hi, how much is a deep clean for a two bedroom house?'), { firstTurn: true, shopLanguage: 'sw' });
    assert.equal(s.current, 'en');
  });
  it('one clear turn mid-call does not switch; two do', () => {
    let s = op.initialLanguageState('en');
    const sw = ev('Nilikuwa nataka kujua bei ya kusafisha nyumba yangu');
    s = op.resolveOpeningLanguage(s, sw, { firstTurn: false, shopLanguage: 'en' });
    assert.equal(s.current, 'en');
    s = op.resolveOpeningLanguage(s, sw, { firstTurn: false, shopLanguage: 'en' });
    assert.equal(s.current, 'sw');
  });
  it('mixed speech needs 2 consecutive turns, even on the first turn', () => {
    const mixed = { language: 'mixed', confidence: 0.55, scores: { en: 2, sw: 3, sheng: 0 } };
    let s = op.resolveOpeningLanguage(op.initialLanguageState('en'), mixed, { firstTurn: true, shopLanguage: 'en' });
    assert.equal(s.current, 'en');
    assert.equal(s.pendingCount, 1);
    s = op.resolveOpeningLanguage(s, mixed, { firstTurn: false, shopLanguage: 'en' });
    assert.equal(s.current, 'sw');
  });
  it('a turn in the current language clears a pending switch', () => {
    const mixed = { language: 'mixed', confidence: 0.55, scores: { en: 1, sw: 3, sheng: 0 } };
    let s = op.resolveOpeningLanguage(op.initialLanguageState('en'), mixed, { firstTurn: true, shopLanguage: 'en' });
    s = op.resolveOpeningLanguage(s, ev('I want to book a cleaning for Friday please'), { shopLanguage: 'en' });
    s = op.resolveOpeningLanguage(s, mixed, { shopLanguage: 'en' });
    assert.equal(s.current, 'en');
  });
  it('a one-word "okay" is not clear evidence', () => {
    const s = op.resolveOpeningLanguage(op.initialLanguageState('sw'), ev('Okay'), { firstTurn: true, shopLanguage: 'sw' });
    assert.equal(s.current, 'sw');
  });
});

/** Fake timers for the store and the ladder. */
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { fn, at: t + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
        await new Promise((r) => setImmediate(r));
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

describe('state machine: session per callSid', () => {
  it('first stream greets; a second stream for the same callSid does not', () => {
    const clock = fakeClock();
    const store = op.createOpeningStore({ ...clock });
    const a = store.attach('HD_x');
    assert.equal(a.action, 'greet');
    assert.equal(a.resumed, false);
    store.noteGreeted(a.session, { text: 'Hapa ni Esga, naitwa Lucy. Nikusaidie vipi?' });
    op.onGreetingDone(a.session);
    store.detach('HD_x', { ended: false, speaking: false });
    assert.equal(a.session.state, op.STATES.DETACHED);
    const b = store.attach('HD_x');
    assert.equal(b.resumed, true);
    assert.equal(b.action, 'listen');
    assert.equal(b.session.streamSeq, 2);
    assert.equal(b.session.state, op.STATES.AWAIT_FIRST);
  });
  it('a line cut mid-way by the drop is re-spoken; a cut greeting re-asks only its question', () => {
    const store = op.createOpeningStore({ ...fakeClock() });
    const a = store.attach('HD_cut');
    store.noteGreeted(a.session, { text: 'Hapa ni Esga, naitwa Lucy. Nikusaidie vipi?' });
    store.detach('HD_cut', { ended: false, speaking: true, line: 'Hapa ni Esga, naitwa Lucy. Nikusaidie vipi?' });
    assert.equal(store.attach('HD_cut').action, 'reinvite');
    op.onRealTurn(a.session);
    store.noteLine(a.session, 'Deep clean ya vyumba viwili ni shilingi elfu nane.');
    store.detach('HD_cut', { ended: false, speaking: true, line: 'Deep clean ya vyumba viwili ni shilingi elfu nane.' });
    const c = store.attach('HD_cut');
    assert.equal(c.action, 'respeak');
    assert.equal(c.session.lastAgentLine, 'Deep clean ya vyumba viwili ni shilingi elfu nane.');
    assert.equal(c.session.state, op.STATES.TURN);
  });
  it('a socket that died before any greeting audio still greets', () => {
    const store = op.createOpeningStore({ ...fakeClock() });
    store.attach('HD_early');
    store.detach('HD_early', { ended: false });
    assert.equal(store.attach('HD_early').action, 'greet');
  });
  it('DETACHED lasts about 20 s; after that (or an ended call) a stream is a new call', async () => {
    const clock = fakeClock();
    const store = op.createOpeningStore({ ...clock });
    const a = store.attach('HD_t');
    store.noteGreeted(a.session, { text: 'x' });
    store.detach('HD_t', { ended: false });
    await clock.advance(op.DETACH_MS - 1);
    assert.ok(store.get('HD_t'));
    await clock.advance(2);
    assert.equal(store.get('HD_t'), null);
    assert.equal(store.attach('HD_t').action, 'greet');
    const e = store.attach('HD_e');
    store.noteGreeted(e.session, { text: 'x' });
    store.detach('HD_e', { ended: true });
    assert.equal(store.get('HD_e'), null);
  });
  it('carry (brain state, history, language) rides the session to the next socket', () => {
    const store = op.createOpeningStore({ ...fakeClock() });
    const a = store.attach('HD_c');
    store.noteGreeted(a.session, { text: 'x' });
    const carry = { brainState: { v: 1 }, messages: [{ role: 'user', content: 'hi' }], languageState: { current: 'sw' }, firstRealTurnDone: true };
    store.detach('HD_c', { ended: false, carry });
    assert.deepEqual(store.attach('HD_c').session.carry, carry);
  });
  it('greeted_at is mirrored through the interface (memory today; DB column is a Platform ask)', async () => {
    const mirror = op.createMemoryGreetedMirror();
    const store = op.createOpeningStore({ ...fakeClock(), mirror });
    const a = store.attach('HD_m');
    store.noteGreeted(a.session, { text: 'x', at: 0 });
    assert.equal((await mirror.read('HD_m')).greeted_at, new Date(0).toISOString());
  });
  it('bare Hello re-invites at most 2 times, never after the first real turn', () => {
    const s = op.createOpeningSession('HD_b');
    assert.deepEqual(op.onBareHello(s, 'Hello?'), { reinvite: true, count: 1 });
    assert.deepEqual(op.onBareHello(s, 'Halo'), { reinvite: true, count: 2 });
    assert.deepEqual(op.onBareHello(s, 'Hello'), { reinvite: false, count: 2 });
    const t = op.createOpeningSession('HD_b2');
    assert.equal(op.onBareHello(t, 'I need a cleaner').reinvite, false);
    op.onRealTurn(t);
    assert.equal(op.onBareHello(t, 'Hello').reinvite, false);
  });
  it('barge mid-greeting: TURN, flagged, never back to OPENING', () => {
    const store = op.createOpeningStore({ ...fakeClock() });
    const a = store.attach('HD_bg');
    store.noteGreeted(a.session, { text: 'x' });
    op.onGreetingBarge(a.session);
    op.onGreetingDone(a.session);
    assert.equal(a.session.state, op.STATES.TURN);
    assert.equal(a.session.greetingBarged, true);
    store.detach('HD_bg', { ended: false });
    assert.equal(store.attach('HD_bg').action, 'listen');
  });
});

describe('silence ladder', () => {
  it('5 s, +10 s, +10 s goodbye, then closed', async () => {
    const clock = fakeClock();
    const spoken = [];
    const ladder = op.createSilenceLadder({
      ...clock,
      canFire: () => true,
      speak: (step) => {
        spoken.push([step, clock.now()]);
        if (step < 3) ladder.arm();
      },
    });
    ladder.arm();
    await clock.advance(4999);
    assert.deepEqual(spoken, []);
    await clock.advance(30000);
    assert.deepEqual(spoken, [[1, 5000], [2, 15000], [3, 25000]]);
    await new Promise((r) => setImmediate(r));
    assert.equal(ladder.closed(), true);
    assert.equal(ladder.arm(), false);
  });
  it('caller speech resets to step 1; a busy line retries instead of dropping the step', async () => {
    const clock = fakeClock();
    const spoken = [];
    let busy = false;
    const ladder = op.createSilenceLadder({ ...clock, canFire: () => !busy, speak: (s) => spoken.push(s) });
    ladder.arm();
    await clock.advance(4000);
    ladder.reset();
    ladder.arm();
    await clock.advance(4000);
    assert.deepEqual(spoken, []);
    busy = true;
    await clock.advance(1500);
    assert.deepEqual(spoken, []);
    busy = false;
    await clock.advance(1000);
    assert.deepEqual(spoken, [1]);
  });
  it('VOICE_OPENING_SILENCE_MS overrides only with 3 sane values', () => {
    assert.deepEqual(op.silenceLadderMs({}), [5000, 10000, 10000]);
    assert.deepEqual(op.silenceLadderMs({ VOICE_OPENING_SILENCE_MS: '300,300,300' }), [300, 300, 300]);
    assert.deepEqual(op.silenceLadderMs({ VOICE_OPENING_SILENCE_MS: '1,2' }), [5000, 10000, 10000]);
  });
});

describe('flag', () => {
  it('VOICE_OPENING_V2 is off unless set on', () => {
    assert.equal(op.openingV2Enabled({}), false);
    assert.equal(op.openingV2Enabled({ VOICE_OPENING_V2: 'off' }), false);
    assert.equal(op.openingV2Enabled({ VOICE_OPENING_V2: 'on' }), true);
    assert.equal(op.openingV2Enabled({ VOICE_OPENING_V2: '1' }), true);
  });
});

describe('recording notice owed after a barge (KDPA)', () => {
  function clock(start = 1000) {
    let t = start;
    return { now: () => t, add: (ms) => (t += ms) };
  }

  it('personal-details asks: name, phone, location (en/sw); other lines are not', () => {
    const yes = {
      name: ['May I have your name?', 'Naomba jina lako?', 'Unaitwa nani?', 'Am I speaking with Alvin?', "What's your name, please?"],
      phone: ['What is your phone number?', 'Namba yako ya simu ni gani?', 'Is this the best number to reach you?'],
      location: ['Where are you located?', 'Uko wapi?', 'Which area are you in?', 'Tukuje wapi?', 'What is your address?'],
    };
    for (const [kind, lines] of Object.entries(yes)) {
      for (const l of lines) assert.equal(op.isPersonalDetailsAsk(l), kind, l);
    }
    for (const l of ['Nikusaidie vipi?', 'Deep cleaning ni shilingi elfu tano.', 'We are in Kilimani.', 'Tuko Westlands.', 'How can I help?']) {
      assert.equal(op.isPersonalDetailsAsk(l), false, l);
    }
  });

  it('greeting heard to the end: given, how=greeting', () => {
    const c = clock();
    const t = op.createNoticeTracker({ required: true, now: c.now });
    c.add(4000);
    t.heardInGreeting();
    assert.deepEqual(
      { given: t.snapshot().given, how: t.snapshot().how, at: t.snapshot().at_ms },
      { given: true, how: 'greeting', at: 4000 }
    );
  });

  it('barge before the notice ends: owed; barge well after it: heard', () => {
    const o = op.composeOpening({ businessName: 'Esga', agentName: 'Lucy', language: 'sw', recordingNotice: true });
    const endMs = op.noticeEndMsIn({ text: o.text, noticeEnd: o.noticeEnd, durationMs: 4000 });
    assert.ok(endMs > 1000 && endMs < 4000, String(endMs));
    const early = op.createNoticeTracker({ required: true });
    assert.equal(early.greetingCut({ playedMs: endMs - 200, noticeEndMs: endMs }), 'owed');
    assert.equal(early.owed(), true);
    const late = op.createNoticeTracker({ required: true });
    assert.equal(late.greetingCut({ playedMs: endMs + op.NOTICE_HEARD_MARGIN_MS + 10, noticeEndMs: endMs }), 'given');
    // Live TTS (no clip length): a barge always owes the notice.
    const live = op.createNoticeTracker({ required: true });
    assert.equal(live.greetingCut({ playedMs: 9000, noticeEndMs: null }), 'owed');
  });

  it('owed notice is given once, before the first ask or save, then never again', () => {
    const c = clock();
    const t = op.createNoticeTracker({ required: true, now: c.now });
    t.greetingCut({ playedMs: 100, noticeEndMs: 2000 });
    c.add(6000);
    assert.equal(t.given('before_ask'), true);
    assert.equal(t.given('before_save'), false, 'only once');
    assert.deepEqual(
      { given: t.snapshot().given, how: t.snapshot().how, at: t.snapshot().at_ms, cut: t.snapshot().cut_at_ms },
      { given: true, how: 'before_ask', at: 6000, cut: 0 }
    );
  });

  it('not required: no recording, or returning with the skip flag', () => {
    const t = op.createNoticeTracker({ required: false });
    assert.equal(t.greetingCut({ playedMs: 0, noticeEndMs: 100 }), 'not_required');
    assert.deepEqual({ g: t.snapshot().given, how: t.snapshot().how }, { g: false, how: 'not_required' });
  });

  it('a drop before the notice was heard leaves it owed on the resumed stream', () => {
    const t = op.createNoticeTracker({ required: true });
    const snap = t.snapshot();
    const r = op.createNoticeTracker({ required: true });
    r.restore(snap);
    assert.equal(r.owed(), true);
    assert.equal(op.noticeLine('sw'), 'Simu hii inaweza kurekodiwa.');
    assert.equal(op.noticeLine('en'), 'This call may be recorded.');
  });
});
