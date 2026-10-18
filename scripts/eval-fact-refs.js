#!/usr/bin/env node
'use strict';
// Replay eval for VOICE_FACT_REFS (tests/fixtures/fact-refs-eval/cases.json).
// Each case is one model sentence the live speech check deleted, judged by
// hand. The replay runs it through the speech path (polishSpokenDetail) with
// the flag off and on, against a snapshot of that business's file, and counts:
// - false deletions: correct text (verdict FP/OFF) whose facts the caller no
//   longer hears;
// - false "not on file": correct text replaced by "I don't have that on file";
// - rightly blocked: TP text that still does not reach the caller.
// The model text is the old prompt's (words, no fact IDs), so this measures
// the fallback path; a model writing IDs never meets these checks.
//
// Usage: node scripts/eval-fact-refs.js [--json]

const path = require('path');

const FIXTURE_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'fact-refs-eval');
const FLAGS = ['VOICE_FACT_REFS', 'VOICE_AREA_FEES'];

function withEnv(env, fn) {
  const prev = {};
  for (const key of FLAGS) prev[key] = process.env[key];
  for (const key of FLAGS) {
    if (env[key] == null) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    return fn();
  } finally {
    for (const key of FLAGS) {
      if (prev[key] == null) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

function loadCases() {
  const doc = require(path.join(FIXTURE_DIR, 'cases.json'));
  const prodTenants = require(path.join(FIXTURE_DIR, 'prod-tenants.json'));
  const snapshots = { ...prodTenants };
  for (const [id, rel] of Object.entries(doc.tenantFixtures || {})) {
    snapshots[id] = require(path.join(FIXTURE_DIR, rel));
  }
  return { cases: doc.cases, snapshots };
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function sentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Numbers read the strict way (digits and compound number words), whatever the flags. */
function factNumbers(text) {
  return withEnv({ VOICE_FACT_REFS: 'on' }, () => require('../src/conversation/numberWords').numbersIn(text));
}

/** The caller still hears the case's facts: every number it stated, or every sentence of it. */
function answerKept(model, out) {
  const said = String(out || '').trim();
  if (!said) return false;
  const nums = [...factNumbers(model)];
  if (nums.length) {
    const outNums = factNumbers(said);
    if (nums.every((n) => outNums.has(n))) return true;
  }
  const hay = ` ${norm(said)} `;
  return sentences(model).every((s) => hay.includes(` ${norm(s)} `));
}

function replayCase(c, snapshot, env) {
  return withEnv(env, () => {
    const { profileFromSnapshot } = require('../src/conversation/promptFacts');
    const { polishSpokenDetail } = require('../src/conversation/dynamicSpeech');
    const { createBrainState } = require('../src/conversation/brainState');
    const { analyzeCallerLanguage } = require('../src/conversation/language');
    const profile = snapshot ? profileFromSnapshot(snapshot) : {};
    const state = createBrainState();
    state.conversation.turnCount = Number(c.turnIndex || 1);
    if (c.savedEarlierInCall) {
      state.actions.savedWork = [{ action: 'create_service_request', status: 'succeeded' }];
    }
    const detected = analyzeCallerLanguage(c.model).language;
    const language = detected === 'sw' || detected === 'sheng' ? detected : 'en';
    const res = polishSpokenDetail(c.model, {
      state,
      profile,
      language,
      callerTurns: [c.caller],
      now: Date.parse(c.at),
    });
    return { text: res.text, dropReasons: res.dropReasons };
  });
}

function scoreRun(cases, snapshots, env) {
  const { NOT_ON_FILE } = notOnFile();
  const rows = [];
  for (const c of cases) {
    const out = replayCase(c, snapshots[c.tenantId], env);
    const kept = answerKept(c.model, out.text);
    rows.push({
      id: c.id,
      verdict: c.verdict,
      expect: c.expect,
      check: c.check,
      kept,
      falseDeletion: c.expect === 'keep' && !kept,
      falseNotOnFile: c.expect === 'keep' && NOT_ON_FILE.test(out.text) && !NOT_ON_FILE.test(c.model),
      leaked: c.expect === 'drop' && kept,
      out: out.text,
    });
  }
  const sum = (key) => rows.filter((r) => r[key]).length;
  return {
    rows,
    totals: {
      cases: rows.length,
      shouldKeep: rows.filter((r) => r.expect === 'keep').length,
      shouldDrop: rows.filter((r) => r.expect === 'drop').length,
      falseDeletions: sum('falseDeletion'),
      falseNotOnFile: sum('falseNotOnFile'),
      wronglyKept: sum('leaked'),
    },
  };
}

function notOnFile() {
  return { NOT_ON_FILE: /don'?t have that on file|not on file|don'?t have that detail|sina hiyo|siko na hiyo|sina maelezo/i };
}

function runEval() {
  const { cases, snapshots } = loadCases();
  return {
    before: scoreRun(cases, snapshots, {}),
    after: scoreRun(cases, snapshots, { VOICE_FACT_REFS: 'on', VOICE_AREA_FEES: 'on' }),
  };
}

if (require.main === module) {
  const res = runEval();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(res, null, 1));
  } else {
    console.log('before', res.before.totals);
    console.log('after ', res.after.totals);
    for (let i = 0; i < res.after.rows.length; i += 1) {
      const a = res.after.rows[i];
      const b = res.before.rows[i];
      if (a.falseDeletion !== b.falseDeletion || a.leaked !== b.leaked || a.falseDeletion || a.leaked) {
        console.log(`${a.id} ${a.verdict} ${a.check} before=${b.kept ? 'kept' : 'lost'} after=${a.kept ? 'kept' : 'lost'} | ${a.out.slice(0, 110)}`);
      }
    }
  }
}

module.exports = { runEval, answerKept, loadCases };
