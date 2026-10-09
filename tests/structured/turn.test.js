const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { runStructuredTurn, historyPartsFor } = require('../../src/speech/structured/turn');
const { correctionTurn } = require('../../src/speech/structured/schema');
const { getLanguagePack } = require('../../src/speech/structured/languages');
const { dustedTable, factId, scripted } = require('./helpers');

const table = dustedTable();
const HOUSE = factId(table, /^3-Bedroom House/);
const KITENGELA = factId(table, /^Kitengela$/);

function reply(say, extra = {}) {
  return { lang: 'en', intent: 'price', facts_used: [{ kind: 'price', id: HOUSE }], say, ...extra };
}

async function run(replies, opts = {}) {
  const { openStream, calls } = scripted(replies, opts);
  const said = [];
  const result = await runStructuredTurn({
    openStream,
    locked: opts.locked || 'en',
    table,
    callerText: opts.callerText || 'How much is a 3-bedroom house?',
    state: opts.state || null,
    nameConfirmed: opts.nameConfirmed || false,
    onSay: async (text, meta) => said.push({ text, ...meta }),
    shouldAbort: opts.shouldAbort,
    correctionFor: (problems) => correctionTurn(opts.locked || 'en', problems),
  });
  return { result, said, calls };
}

describe('structured turn engine', () => {
  it('speaks a grounded reply verbatim, sentence by sentence, in one call', async () => {
    const say = ['A standard 3-bedroom house clean is 6,000 shillings flat.', 'Would you like to book it?'];
    const { result, said, calls } = await run([reply(say)]);
    assert.deepEqual(said.map((s) => s.text), say);
    assert.equal(calls.length, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.repaired, false);
    assert.deepEqual(result.transforms, []);
    assert.equal(result.intent, 'price');
  });

  it('regenerates once when the first sentence states an unbacked price', async () => {
    const bad = reply(['A 3-bedroom house is 6,500 shillings.']);
    const good = reply(['A 3-bedroom house is 6,000 shillings flat.']);
    const { result, said, calls } = await run([bad, good]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].correction.role, 'user');
    assert.match(calls[1].correction.parts[0].text, /unbacked_number/);
    assert.deepEqual(said.map((s) => s.text), ['A 3-bedroom house is 6,000 shillings flat.']);
    assert.equal(result.regenerated, true);
  });

  it('answers from data when the retry is still wrong (never a silent drop)', async () => {
    const bad = reply(['A 3-bedroom house is 6,500 shillings.']);
    const { result, said } = await run([bad, bad]);
    assert.deepEqual(said.map((s) => s.text), ['3-Bedroom House is KSh 6,000 flat.']);
    assert.equal(said[0].source, 'data');
    const t = result.transforms.find((row) => row.name === 'structured_verify');
    assert.equal(t.reason, 'unbacked_number');
    assert.equal(t.before, 'A 3-bedroom house is 6,500 shillings.');
  });

  it('fixes a coverage contradiction from the coverage list', async () => {
    const bad = { lang: 'en', intent: 'coverage', facts_used: [], say: ['Kitengela is outside our area.'] };
    const { said } = await run([bad, bad], { callerText: 'Can you come to Kitengela?' });
    assert.deepEqual(said.map((s) => s.text), ['Yes, we cover Kitengela.']);
  });

  it('HD_23445a4f780c: an "outside Nairobi" answer is spoken, not swapped for "Ndiyo, tunafika Syokimau."', async () => {
    const good = {
      lang: 'sw',
      intent: 'coverage',
      facts_used: [],
      say: ['Kama uko nje ya Nairobi, tunafika Kiambu, Kitengela, Juja, Ongata Rongai na Syokimau.'],
    };
    const { said, calls } = await run([good, good], { callerText: 'Mmh, na kama niko outside Nairobi, how is it done?', locked: 'sw' });
    assert.equal(calls.length, 1);
    assert.deepEqual(said.map((s) => s.text), good.say);
    const denied = { lang: 'sw', intent: 'coverage', facts_used: [], say: ['Hatufiki Syokimau.'] };
    const second = await run([denied, denied], { callerText: 'Mmh, na kama niko outside Nairobi, how is it done?', locked: 'sw' });
    assert.ok(!second.said.some((s) => /tunafika Syokimau/.test(s.text)), JSON.stringify(second.said));
  });

  it('a wrong lang field triggers the one retry before anything is spoken', async () => {
    const wrong = { lang: 'sw', intent: 'other', facts_used: [], say: ['Sawa.'] };
    const right = { lang: 'en', intent: 'other', facts_used: [], say: ['Okay, noted.'] };
    const { result, said, calls } = await run([wrong, right]);
    assert.equal(calls.length, 2);
    assert.deepEqual(said.map((s) => s.text), ['Okay, noted.']);
    assert.ok(result.problems.some((p) => p.code === 'language_field'));
  });

  it('a sentence in the wrong language is retried, then never spoken', async () => {
    const sw = { lang: 'en', intent: 'other', facts_used: [], say: ['Tunafanya usafi wa nyumba na ofisi kila siku.'] };
    const { result, said, calls } = await run([sw, sw]);
    assert.equal(calls.length, 2);
    assert.deepEqual(said.map((s) => s.text), [getLanguagePack('en').repair]);
    assert.equal(result.repaired, true);
    assert.ok(result.transforms.some((t) => t.name === 'structured_repair'));
  });

  it('broken JSON twice speaks the repair line in the locked language', async () => {
    const { openStream } = {
      openStream: async () =>
        (async function* gen() {
          yield { candidates: [{ content: { role: 'model', parts: [{ text: '{"lang":"sw","say":["Hab' }] } }] };
        })(),
    };
    const said = [];
    const result = await runStructuredTurn({
      openStream,
      locked: 'sw',
      table,
      onSay: (text) => said.push(text),
    });
    assert.deepEqual(said, [getLanguagePack('sw').repair]);
    assert.equal(result.attempts, 2);
    assert.ok(result.problems.some((p) => p.code === 'schema_parse'));
  });

  it('keeps one question (the first asked), spoken last', async () => {
    const say = ['What day works for you?', 'A 3-bedroom house is 6,000 shillings flat.', 'How else can I help?'];
    const { result, said } = await run([reply(say)]);
    assert.deepEqual(said.map((s) => s.text), ['A 3-bedroom house is 6,000 shillings flat.', 'What day works for you?']);
    assert.ok(result.transforms.some((t) => t.reason === 'stacked_question' && t.before === 'How else can I help?'));
  });

  it('moves a leading question after the answer', async () => {
    const say = ['Would you like to book?', 'A 3-bedroom house is 6,000 shillings flat.'];
    const { said } = await run([reply(say)]);
    assert.deepEqual(said.map((s) => s.text), ['A 3-bedroom house is 6,000 shillings flat.', 'Would you like to book?']);
  });

  it('stops on barge-in without a repair line', async () => {
    let aborted = false;
    const say = ['A 3-bedroom house is 6,000 shillings flat.', 'It covers every room.', 'Shall I book it?'];
    const { openStream } = scripted([reply(say)], { chunkChars: 5 });
    const said = [];
    const result = await runStructuredTurn({
      openStream,
      locked: 'en',
      table,
      callerText: '3-bedroom',
      onSay: (text) => {
        said.push(text);
        aborted = true;
      },
      shouldAbort: () => aborted,
    });
    assert.equal(said.length, 1);
    assert.equal(result.aborted, true);
    assert.equal(result.repaired, false);
  });

  it('a provider error before speech is returned to the caller loop', async () => {
    const err = Object.assign(new Error('503 UNAVAILABLE'), { status: 503 });
    const { result, said } = await run([err]);
    assert.equal(said.length, 0);
    assert.equal(result.providerError, err);
    assert.equal(result.repaired, false);
  });

  it('rebuilds the tool and end-call markers for the existing tool path', async () => {
    const value = {
      lang: 'en',
      intent: 'handoff',
      facts_used: [],
      say: ['I will pass this to the team.'],
      tool: { name: 'escalate', args_json: JSON.stringify({ teammate: 'owner', reason: 'complaint' }) },
      end_call: true,
    };
    const { result } = await run([value]);
    assert.equal(
      result.toolText,
      '###TOOL###{"escalate":{"teammate":"owner","reason":"complaint"}}###ENDTOOL### ###ENDCALL###'
    );
  });

  it('a claimed booking before the tool runs is never spoken', async () => {
    const bad = { lang: 'en', intent: 'booking', facts_used: [], say: ["I've booked you for Monday."] };
    const { said, result } = await run([bad, bad]);
    assert.ok(!said.some((s) => /booked/.test(s.text)));
    assert.ok(result.problems.some((p) => p.code === 'outcome_claim'));
  });

  it('privacy: the caller file is not read before the speaker is bound', async () => {
    const state = {
      caller: { name: '', nameConfirmed: false },
      returning: { fileOwnerName: 'Alvin', openVisits: [{ service: 'Couch cleaning', whenText: 'Monday' }] },
      conversation: { answersReceived: [] },
    };
    const bad = { lang: 'en', intent: 'visit_lookup', facts_used: [], say: ['You have Couch cleaning on Monday, Alvin.'] };
    const { said } = await run([bad, bad], { state });
    assert.ok(!said.some((s) => /Couch cleaning on Monday/.test(s.text)), JSON.stringify(said));
  });
});

describe('structured history', () => {
  it('keeps the signed parts when the model reply was spoken verbatim', async () => {
    const say = ['A 3-bedroom house is 6,000 shillings flat.'];
    const { result } = await run([reply(say)]);
    const history = historyPartsFor(result);
    assert.equal(history.rewritten, false);
    assert.deepEqual(JSON.parse(history.parts.map((p) => p.text || '').join('')).say, say);
  });

  it('stores what was actually spoken when the engine replaced a sentence', async () => {
    const bad = reply(['A 3-bedroom house is 6,500 shillings.']);
    const { result } = await run([bad, bad]);
    const history = historyPartsFor(result);
    assert.equal(history.rewritten, true);
    assert.deepEqual(JSON.parse(history.text).say, ['3-Bedroom House is KSh 6,000 flat.']);
  });

  it('a held reply that was never spoken leaves an empty say', async () => {
    const { result } = await run([reply(['A 3-bedroom house is 6,000 shillings flat.'])]);
    const history = historyPartsFor(result, { spokenLines: [] });
    assert.deepEqual(JSON.parse(history.text).say, []);
  });
});

void KITENGELA;

describe('structured turn: short openers', () => {
  it('a short opener waits for the next sentence, so a failure there still regenerates', async () => {
    const bad = { lang: 'en', intent: 'complaint', facts_used: [], say: ['Pole sana.', 'Naelewa vizuri uko na lalamiko na sijaishughulikia ipasavyo.'] };
    const good = { lang: 'en', intent: 'complaint', facts_used: [], say: ['I am sorry about that.', 'Please tell me what went wrong.'] };
    const { said, calls } = await run([bad, good]);
    assert.equal(calls.length, 2);
    assert.deepEqual(said.map((s) => s.text), good.say);
  });
  it('a short reply on its own is still spoken', async () => {
    const { said } = await run([{ lang: 'en', intent: 'smalltalk', facts_used: [], say: ['Okay, noted.'] }]);
    assert.deepEqual(said.map((s) => s.text), ['Okay, noted.']);
  });
});
