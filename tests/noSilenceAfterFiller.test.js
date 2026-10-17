'use strict';

// VOICE_NO_SILENCE_AFTER_FILLER (default off): a filler or hold is always
// followed by speech in the caller's language; a succeeded tool is always
// acknowledged; a dropped callback promise is replaced by an honest offer.
// HD_c427511e5773 (prod Aris, 17 Oct 2026) t10/t11.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ns = require('../src/speech/noSilenceAfterFiller');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { polishSpokenDetail, planEmptyGeminiSpeech } = require('../src/conversation/dynamicSpeech');
const { formatToolConfirmation } = require('../src/conversation/toolExecution');
const { stripSavedClaimAfterReceipt, foldOwedIntoReply } = require('../src/speech/owedConfirmFold');

const FIX = require(path.join(__dirname, 'fixtures', 'no-silence-after-filler', 'HD_c427511e5773.t10-t11.json'));
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function withFlag(value, fn) {
  const before = process.env.VOICE_NO_SILENCE_AFTER_FILLER;
  if (value == null) delete process.env.VOICE_NO_SILENCE_AFTER_FILLER;
  else process.env.VOICE_NO_SILENCE_AFTER_FILLER = value;
  try {
    return fn();
  } finally {
    if (before == null) delete process.env.VOICE_NO_SILENCE_AFTER_FILLER;
    else process.env.VOICE_NO_SILENCE_AFTER_FILLER = before;
  }
}

function quiet(fn) {
  const { warn, log } = console;
  console.warn = () => {};
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
    console.log = log;
  }
}

function guard(text, { caller, toolResults = [], language = 'en', capabilities = {} } = {}) {
  const ctx = {
    profile: FIX.profile,
    callerTurns: [caller || 'hello'],
    toolResults,
    capabilities,
    language,
    dropReasons: [],
    allowEmpty: true,
    state: { conversation: { turnCount: 10 }, entities: {} },
  };
  const out = quiet(() => guardSpokenReply(text, ctx));
  return { out, drops: ctx.dropReasons };
}

/**
 * The end of a tool-only turn in server.js order (actionConfirmation branch,
 * held claims, empty-turn repair, gap fallback), built from the same helpers.
 */
function closeToolOnlyTurn({ toolResults, language = 'en', userText, foldEnabled, alreadyOffered, fillerPlayed, enabled, heldClaims = [] }) {
  const spoken = [];
  let offered = alreadyOffered;
  let confirmationSpoke = false;
  let confirmation = String(formatToolConfirmation(toolResults, language) || '').trim();
  if (confirmation) {
    if (ns.stripFreshReceipt({ foldEnabled, owedReceipt: '', owedFolded: false, enabled })) {
      confirmation = stripSavedClaimAfterReceipt(confirmation);
    }
    if (confirmation) {
      spoken.push(confirmation);
      confirmationSpoke = true;
    }
  }
  if (enabled && heldClaims.length) {
    const plan = ns.planHeldClaims({ held: heldClaims, toolResults, confirmationSpoken: confirmationSpoke, language });
    if (plan.line) spoken.push(plan.line);
  }
  let outcome = 'ok';
  if (!spoken.length) {
    const planned = planEmptyGeminiSpeech({
      brainState: {},
      language,
      userText,
      alreadyOffered: offered,
      toolResults,
      toolOutcomeFirst: enabled,
    });
    if (planned.speak && planned.line) {
      if (!(enabled && planned.kind === 'tool_outcome')) offered = true;
      spoken.push(planned.line);
      outcome = 'speech_repair';
    } else {
      outcome = 'speech_quiet';
    }
  }
  if (enabled && !spoken.length && fillerPlayed) {
    const gap = ns.gapFallbackLine({ toolResults, language });
    spoken.push(gap.line);
    outcome = 'gap_fallback';
  }
  return { spoken, outcome, offered };
}

test('flag is off unless on/1/true/yes', () => {
  assert.equal(ns.noSilenceAfterFillerEnabled({}), false);
  assert.equal(ns.noSilenceAfterFillerEnabled({ VOICE_NO_SILENCE_AFTER_FILLER: 'off' }), false);
  for (const v of ['on', '1', 'true', 'YES']) assert.equal(ns.noSilenceAfterFillerEnabled({ VOICE_NO_SILENCE_AFTER_FILLER: v }), true);
});

for (const flag of [null, 'off']) {
  const label = flag == null ? 'unset' : 'off';
  test(`parity (${label}): HD_c427511e5773 t11 still ends speech_quiet`, () => {
    withFlag(flag, () => {
      const r = closeToolOnlyTurn({
        toolResults: FIX.t11.toolResults,
        userText: FIX.t11.caller,
        foldEnabled: true,
        alreadyOffered: true,
        fillerPlayed: true,
        enabled: ns.noSilenceAfterFillerEnabled(),
      });
      assert.deepEqual(r.spoken, []);
      assert.equal(r.outcome, FIX.t11.outcomeBefore);
    });
  });
  test(`parity (${label}): HD_c427511e5773 t10 guard output, drops and transfer handling unchanged`, () => {
    withFlag(flag, () => {
      const r = guard(FIX.t10.model, { caller: FIX.t10.caller });
      assert.equal(r.out, FIX.t10.spoken);
      assert.deepEqual(r.drops, ['saved_claim']);
      const withTool = guard(FIX.t10.model, { caller: FIX.t10.caller, toolResults: FIX.t11.toolResults });
      assert.deepEqual(withTool.drops, ['transfer_claim']);
      const detail = quiet(() =>
        polishSpokenDetail(FIX.t10.model, { profile: FIX.profile, callerTurns: [FIX.t10.caller], state: { conversation: { turnCount: 10 }, entities: {} } })
      );
      assert.equal(detail.droppedSentences, undefined);
      assert.equal(ns.stripFreshReceipt({ foldEnabled: true, owedReceipt: '', owedFolded: false, enabled: false }), true);
    });
  });
}

test('flag on: HD_c427511e5773 t11 speaks the receipt (fold on, nothing owed, repair already spent)', () => {
  withFlag('on', () => {
    const r = closeToolOnlyTurn({
      toolResults: FIX.t11.toolResults,
      userText: FIX.t11.caller,
      foldEnabled: true,
      alreadyOffered: FIX.t11.emptyRepairOfferedBefore,
      fillerPlayed: true,
      enabled: true,
    });
    assert.deepEqual(r.spoken, ["Okay, I've saved your request."]);
    assert.notEqual(r.outcome, 'speech_quiet');
  });
});

test('flag on: an owed receipt folded this turn still strips the second claim (no double receipt)', () => {
  withFlag('on', () => {
    assert.equal(ns.stripFreshReceipt({ foldEnabled: true, owedReceipt: '', owedFolded: true, enabled: true }), true);
    assert.equal(ns.stripFreshReceipt({ foldEnabled: true, owedReceipt: 'x', owedFolded: false, enabled: true }), false);
    assert.equal(ns.stripFreshReceipt({ foldEnabled: false, owedReceipt: '', owedFolded: true, enabled: true }), false);
    const folded = foldOwedIntoReply("Okay, I've saved your visit request.", ["Okay, I've saved your request.", 'Anything else?']);
    assert.deepEqual(folded.lines, ["Okay, I've saved your visit request.", 'Anything else?']);
  });
});

test('flag on: a tool outcome outranks the spent repair budget, and does not spend it', () => {
  const tool = planEmptyGeminiSpeech({ brainState: {}, language: 'en', userText: FIX.t11.caller, alreadyOffered: true, toolResults: FIX.t11.toolResults, toolOutcomeFirst: true });
  assert.equal(tool.kind, 'tool_outcome');
  assert.equal(tool.line, "Okay, I've saved your request.");
  const none = planEmptyGeminiSpeech({ brainState: {}, language: 'en', userText: 'mm', alreadyOffered: true, toolResults: [], toolOutcomeFirst: true });
  assert.equal(none.kind, 'quiet_continue');
  const before = planEmptyGeminiSpeech({ brainState: {}, language: 'en', userText: FIX.t11.caller, alreadyOffered: true, toolResults: FIX.t11.toolResults });
  assert.equal(before.kind, 'quiet_continue');
  withFlag('on', () => {
    const r = closeToolOnlyTurn({ toolResults: [{ action: 'create_service_request', status: 'succeeded', requestType: 'enquiry' }], userText: 'ok', foldEnabled: false, alreadyOffered: false, fillerPlayed: false, enabled: true });
    assert.equal(r.offered, false);
  });
});

test('flag on: HD_c427511e5773 t10 holds the promise and speaks an honest offer when no tool ran', () => {
  withFlag('on', () => {
    const detail = quiet(() =>
      polishSpokenDetail(FIX.t10.model, { profile: FIX.profile, callerTurns: [FIX.t10.caller], toolResults: [], state: { conversation: { turnCount: 10 }, entities: {} }, language: 'en' })
    );
    assert.equal(detail.text, FIX.t10.spoken);
    assert.deepEqual(detail.dropReasons, ['saved_claim']);
    const held = detail.droppedSentences.filter((d) => d.reason === 'saved_claim').map((d) => d.sentence);
    assert.deepEqual(held, [FIX.t10.dropped]);
    const plan = ns.planHeldClaims({ held, toolResults: [], language: 'en' });
    assert.equal(plan.kind, 'offer');
    assert.equal(plan.line, 'Would you like me to pass your question to the team?');
    assert.doesNotMatch(plan.line, /will (call|contact)|tomorrow|today|minutes|hours/i);
  });
});

test('flag on: the t10 promise passes when escalate/create_service_request succeeded (callback, not transfer)', () => {
  withFlag('on', () => {
    const r = guard(FIX.t10.model, { caller: FIX.t10.caller, toolResults: [{ action: 'escalate', status: 'succeeded' }] });
    assert.equal(r.out, FIX.t10.model);
    assert.deepEqual(r.drops, []);
    const req = guard(FIX.t10.model, { caller: FIX.t10.caller, toolResults: FIX.t11.toolResults });
    assert.equal(req.out, FIX.t10.model);
    // Only save_caller_info succeeded: not a callback tool.
    const info = guard('Let me escalate this to our team.', { toolResults: [{ action: 'save_caller_info', status: 'succeeded' }] });
    assert.deepEqual(info.drops, ['saved_claim']);
  });
});

test('flag on: a live-transfer phrase without the transfer capability is still transfer_claim', () => {
  withFlag('on', () => {
    for (const text of ["I'm connecting you now.", 'Please stay on the line.']) {
      const r = guard(text, { toolResults: [{ action: 'escalate', status: 'succeeded' }] });
      assert.equal(r.out, '', text);
      assert.deepEqual(r.drops, ['transfer_claim'], text);
    }
  });
});

test('flag on: held claim after a failed tool stays dropped (the failure line speaks)', () => {
  const plan = ns.planHeldClaims({ held: [FIX.t10.dropped], toolResults: [{ action: 'create_service_request', status: 'failed' }] });
  assert.equal(plan.kind, 'none');
  assert.equal(plan.reason, 'tool_failed');
});

test('flag on: held claim with a succeeded tool: receipt spoken -> nothing more; no receipt -> re-guarded claim', () => {
  const ok = [{ action: 'escalate', status: 'succeeded' }];
  assert.equal(ns.planHeldClaims({ held: [FIX.t10.dropped], toolResults: ok, confirmationSpoken: true }).line, '');
  withFlag('on', () => {
    const plan = ns.planHeldClaims({
      held: [FIX.t10.dropped],
      toolResults: ok,
      confirmationSpoken: false,
      regard: (text) => guard(text, { toolResults: ok }).out,
    });
    assert.equal(plan.kind, 'claim');
    assert.equal(plan.line, FIX.t10.dropped);
  });
});

test('flag on: Swahili caller gets the receipt and offer in Swahili', () => {
  withFlag('on', () => {
    const r = closeToolOnlyTurn({ toolResults: FIX.t11.toolResults, language: 'sw', userText: 'Sawa asante, nitapita kesho', foldEnabled: true, alreadyOffered: true, fillerPlayed: true, enabled: true });
    assert.equal(r.spoken.length, 1);
    assert.match(r.spoken[0], /nimehifadhi|ombi/i);
    assert.doesNotMatch(r.spoken[0], /saved your request/);
    assert.equal(ns.callbackOfferLine('sw'), 'Ungependa nipeleke swali lako kwa timu?');
    assert.equal(ns.callbackOfferLine('sheng'), 'Ungependa ni-pass swali yako kwa team?');
  });
});

test('flag on: gap fallback order — receipt, then open slot, then neutral line (en/sw/sheng)', () => {
  assert.equal(ns.gapFallbackLine({ toolResults: FIX.t11.toolResults, language: 'en' }).kind, 'tool_receipt');
  assert.deepEqual(ns.gapFallbackLine({ toolResults: [], language: 'en', slotLine: 'Which item would you like?' }), { line: 'Which item would you like?', kind: 'open_slot' });
  assert.deepEqual(ns.gapFallbackLine({ language: 'en' }), { line: 'Okay, noted. Anything else I can help with?', kind: 'neutral' });
  assert.equal(ns.gapFallbackLine({ language: 'sw' }).line, 'Sawa, nimeandika. Kuna kingine nikusaidie?');
  assert.equal(ns.gapFallbackLine({ language: 'sheng' }).line, 'Poa, nime-note. Kuna kingine?');
  for (const lang of ['en', 'sw', 'sheng']) {
    assert.doesNotMatch(ns.gapFallbackLine({ language: lang }).line, /will (call|contact)|tutakupigia|watakupigia|price|bei/i);
  }
});

test('flag on: a filler with nothing else to say ends on the neutral line, never silence', () => {
  withFlag('on', () => {
    const r = closeToolOnlyTurn({ toolResults: [], userText: 'mm', foldEnabled: true, alreadyOffered: true, fillerPlayed: true, enabled: true });
    assert.deepEqual(r.spoken, ['Okay, noted. Anything else I can help with?']);
    assert.equal(r.outcome, 'gap_fallback');
    const noFiller = closeToolOnlyTurn({ toolResults: [], userText: 'mm', foldEnabled: true, alreadyOffered: true, fillerPlayed: false, enabled: true });
    assert.equal(noFiller.outcome, 'speech_quiet');
  });
});

test('server wiring: flag-gated fold fix, held claims, tool-outcome-first and the gap fallback', () => {
  assert.match(SERVER, /require\('\.\/src\/speech\/noSilenceAfterFiller'\)/);
  assert.match(SERVER, /const noSilenceTurn = noSilenceAfterFillerEnabled\(\);/);
  assert.match(SERVER, /stripFreshReceipt\(\{\s*foldEnabled: owedConfirmFoldEnabled\(\),\s*owedReceipt: owedReceiptForFold,\s*owedFolded: owedFoldedThisTurn,\s*enabled: noSilenceTurn,/);
  assert.match(SERVER, /if \(folded\.folded\) owedFoldedThisTurn = true;/);
  assert.match(SERVER, /toolOutcomeFirst: noSilenceTurn,/);
  assert.match(SERVER, /if \(!\(noSilenceTurn && planned\.kind === 'tool_outcome'\)\) emptyRepairOffered = true;/);
  assert.match(SERVER, /noSilenceTurn && !spokeThisTurn && !bargeInActive && tts && ackPlayedTurn === turnTiming/);
  assert.match(SERVER, /turnOutcome = 'gap_fallback';/);
  assert.match(SERVER, /drop\.reason === 'saved_claim' && drop\.sentence\) heldClaims\.push/);
  assert.match(SERVER, /noSilenceTurn && heldClaims\.length && !bargeInActive && tts/);
  // The gap fallback runs after the empty-turn repair, the held claims after the receipt.
  assert.ok(SERVER.indexOf("turnOutcome = 'gap_fallback';") > SERVER.indexOf("reason=empty_answer"));
  assert.ok(SERVER.indexOf('planHeldClaims({') > SERVER.indexOf('confirmationSpokeThisTurn = true;'));
});
