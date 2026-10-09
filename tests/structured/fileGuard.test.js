// HD_1b3a67ea7ee9: the structured mouth runs Brain's caller-file speech guard
// (claimsNoRecord / fileMasked, the file-name ask once) and tells the model
// the file is masked, not empty, before the name confirm.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { verifySay, dataLineFor } = require('../../src/speech/structured/verify');
const { runStructuredTurn } = require('../../src/speech/structured/turn');
const { correctionTurn } = require('../../src/speech/structured/schema');
const { getLanguagePack } = require('../../src/speech/structured/languages');
const { buildFactTable, formatFactsBlock, MASKED_FILE_RULE } = require('../../src/speech/structured/facts');
const fileGuard = require('../../src/speech/structured/fileGuard');
const { DUSTED, dustedTable, scripted } = require('./helpers');

const table = dustedTable();
const NO_BOOKINGS = "I don't see any bookings saved under this number.";

function maskedState(extra = {}) {
  return {
    caller: { nameConfirmed: false, fileNameAsked: 'Wanjiku', ...(extra.caller || {}) },
    returning: {
      fileOwnerName: 'Wanjiku',
      hasOpenRows: true,
      openRows: [{ kind: 'visit', job: 'Carpet Cleaning', status: 'requested' }],
      openVisits: [{ service: 'Carpet Cleaning', status: 'requested' }],
    },
    conversation: { turnCount: 3, ...(extra.conversation || {}) },
  };
}

// Stand-in for Brain's src/conversation/callFixesD199.js (#634) so these
// tests run on #614 alone; same exports and semantics.
function fakeBrain({ on = true } = {}) {
  const hasRows = (s) => s?.returning?.hasOpenRows === true || (s?.returning?.openRows || []).length > 0;
  return {
    callFixesD199Enabled: () => on,
    fileHasRows: hasRows,
    fileMasked: (s) => s?.caller?.nameConfirmed !== true && hasRows(s),
    claimsNoRecord: (t) => /\b(?:no|don'?t see any)\s+(?:bookings?|visits?|records?)\b|\bhakuna\s+(?:booking|ziara)\b/i.test(String(t)),
    agentAskedFileName: (t, name) => new RegExp(`\\b(?:am i speaking with|is this|naongea na)\\s+${name.split(/\s+/)[0]}\\b`, 'i').test(String(t)),
    confirmIdentityFirst: (s, lang, { askAllowed = true } = {}) => {
      const ask = askAllowed && s.caller.fileNameAskSpoken !== true;
      if (ask) {
        s.caller.fileNameAskSpoken = true;
        s.conversation.fileNameAskTurn = s.conversation.turnCount;
      }
      const line = lang === 'sw'
        ? (ask ? 'Wacha nithibitishe kwanza, naongea na Wanjiku?' : 'Wacha nithibitishe kwanza naongea na nani.')
        : (ask ? "Let me just confirm who I'm speaking with, is this Wanjiku?" : "Let me just confirm who I'm speaking with first.");
      return { line, lines: [{ template: 'confirm_identity_first', lang, slots: { name: 'Wanjiku', ask } }] };
    },
    openFileRead: () => ({ line: 'You have a Carpet Cleaning visit request.', lines: [] }),
  };
}

const codes = (r) => r.problems.map((p) => p.code);

afterEach(() => fileGuard.setBrainFixesForTest(undefined));

describe('verifySay runs Brain\'s file guard (HD_1b3a67ea7ee9)', () => {
  it('a no-bookings claim while the file is masked fails; the data line is confirm_identity_first with the ask', () => {
    fileGuard.setBrainFixesForTest(fakeBrain());
    const state = maskedState();
    const r = verifySay(NO_BOOKINGS, { locked: 'en', table, state });
    assert.ok(codes(r).includes('no_record_claim'));
    assert.match(r.problems.find((p) => p.code === 'no_record_claim').detail, /masked, not empty/);
    const line = dataLineFor(NO_BOOKINGS, r.problems, { table, pack: getLanguagePack('en'), state });
    assert.equal(line, "Let me just confirm who I'm speaking with, is this Wanjiku?");
    assert.equal(state.caller.fileNameAskSpoken, true);
  });
  it('bound with open rows: the claim is replaced by the open-file read', () => {
    fileGuard.setBrainFixesForTest(fakeBrain());
    const state = maskedState({ caller: { nameConfirmed: true } });
    const r = verifySay('There are no bookings on file.', { locked: 'en', table, state, nameConfirmed: true });
    assert.ok(codes(r).includes('no_record_claim'));
    assert.equal(dataLineFor('x', r.problems, { table, pack: getLanguagePack('en'), state }), 'You have a Carpet Cleaning visit request.');
  });
  it('the file-name ask is not asked twice', () => {
    fileGuard.setBrainFixesForTest(fakeBrain());
    const state = maskedState({ caller: { fileNameAskSpoken: true }, conversation: { fileNameAskTurn: 1 } });
    assert.deepEqual(codes(verifySay('Am I speaking with Wanjiku?', { locked: 'en', table, state })), ['name_ask_repeat']);
    // Already asked: the replacement carries no second ask.
    const r = verifySay(NO_BOOKINGS, { locked: 'en', table, state });
    assert.equal(dataLineFor('x', r.problems, { table, pack: getLanguagePack('en'), state }), "Let me just confirm who I'm speaking with first.");
    // Same turn as the ask: still allowed (Brain's rule).
    const sameTurn = maskedState({ caller: { fileNameAskSpoken: true }, conversation: { fileNameAskTurn: 3 } });
    assert.deepEqual(codes(verifySay('Am I speaking with Wanjiku?', { locked: 'en', table, state: sameTurn })), []);
  });
  it('flag off, Brain module missing, empty file, or no state: unchanged', () => {
    fileGuard.setBrainFixesForTest(fakeBrain({ on: false }));
    assert.deepEqual(codes(verifySay(NO_BOOKINGS, { locked: 'en', table, state: maskedState() })), []);
    fileGuard.setBrainFixesForTest(null);
    assert.deepEqual(codes(verifySay(NO_BOOKINGS, { locked: 'en', table, state: maskedState() })), []);
    assert.equal(dataLineFor('x', [{ code: 'no_record_claim' }], { table, pack: getLanguagePack('en'), state: maskedState() }), '');
    fileGuard.setBrainFixesForTest(fakeBrain());
    const empty = { caller: { nameConfirmed: false }, returning: { openRows: [] }, conversation: { turnCount: 1 } };
    assert.deepEqual(codes(verifySay(NO_BOOKINGS, { locked: 'en', table, state: empty })), []);
    assert.deepEqual(codes(verifySay(NO_BOOKINGS, { locked: 'en', table })), []);
  });
});

describe('runStructuredTurn: "no bookings" never reaches the caller while masked', () => {
  async function run(replies, state, locked = 'en') {
    const { openStream, calls } = scripted(replies);
    const said = [];
    const result = await runStructuredTurn({
      openStream,
      locked,
      table,
      callerText: 'About my booking.',
      state,
      onSay: async (text) => said.push(text),
      correctionFor: (problems) => correctionTurn(locked, problems),
    });
    return { result, said, calls };
  }
  const bad = { lang: 'en', intent: 'other', facts_used: [], say: [NO_BOOKINGS, 'Would you like to make a new one?'] };

  it('regenerates once with the reason, then speaks confirm_identity_first in place of the claim', async () => {
    fileGuard.setBrainFixesForTest(fakeBrain());
    const state = maskedState();
    const { said, calls } = await run([bad, bad], state);
    assert.equal(calls.length, 2);
    assert.match(calls[1].correction.parts[0].text, /no_record_claim \(the caller file is masked, not empty\)/);
    assert.ok(!said.some((t) => /don't see any bookings/i.test(t)), said.join(' | '));
    assert.equal(said[0], "Let me just confirm who I'm speaking with, is this Wanjiku?");
  });
  it('a spoken file-name ask marks the ask spoken (code-held)', async () => {
    fileGuard.setBrainFixesForTest(fakeBrain());
    const state = maskedState();
    const ask = { lang: 'en', intent: 'other', facts_used: [], say: ['Sure, I can help with that.', 'Am I speaking with Wanjiku?'] };
    await run([ask], state);
    assert.equal(state.caller.fileNameAskSpoken, true);
    assert.equal(state.conversation.fileNameAskTurn, 3);
  });
});

describe('facts.js: masked, not empty (HD_1b3a67ea7ee9)', () => {
  it('before the confirm the block says the file is masked, not empty, and lists no visits', () => {
    const t = buildFactTable(DUSTED, { state: maskedState(), speakerBound: false });
    assert.equal(t.callerFile, 'masked');
    const block = formatFactsBlock(t);
    assert.ok(block.includes(MASKED_FILE_RULE));
    assert.match(block, /MASKED, not empty/);
    assert.doesNotMatch(block, /\[vis:/);
    // Empty table too.
    assert.match(formatFactsBlock(buildFactTable({}, { state: maskedState(), speakerBound: false })), /MASKED, not empty/);
  });
  it('bound or no rows: no masked line', () => {
    assert.equal(buildFactTable(DUSTED, { state: maskedState(), speakerBound: true }).callerFile, 'bound');
    const none = buildFactTable(DUSTED, { state: { caller: {}, returning: { openRows: [] } }, speakerBound: false });
    assert.equal(none.callerFile, 'none');
    assert.doesNotMatch(formatFactsBlock(none), /MASKED/);
    assert.doesNotMatch(formatFactsBlock(table), /MASKED/);
  });
});

// With Brain's real module on the branch (#634), the same check end to end.
let brainReal = null;
try {
  // eslint-disable-next-line global-require
  brainReal = require('../../src/conversation/callFixesD199');
  if (typeof brainReal.fileMasked !== 'function') brainReal = null;
} catch {
  brainReal = null;
}
describe('with Brain\'s callFixesD199 (#634)', { skip: !brainReal && 'Brain #634 not on this branch' }, () => {
  it('HD_1b3a67ea7ee9: "no bookings saved under this number" fails while masked (flag on)', () => {
    const prev = process.env.BRAIN_CALL_FIXES_D199;
    process.env.BRAIN_CALL_FIXES_D199 = 'on';
    try {
      fileGuard.setBrainFixesForTest(undefined);
      const state = maskedState();
      const r = verifySay('There are no bookings saved under this number.', { locked: 'en', table, state });
      assert.ok(codes(r).includes('no_record_claim'));
      const line = dataLineFor('x', r.problems, { table, pack: getLanguagePack('en'), state });
      assert.ok(line && !/no bookings/i.test(line), line);
      assert.match(line, /confirm who I'm speaking with/i);
    } finally {
      if (prev === undefined) delete process.env.BRAIN_CALL_FIXES_D199;
      else process.env.BRAIN_CALL_FIXES_D199 = prev;
    }
  });
});
