'use strict';
// Replay anonymised caller turns through the lookup router, and model
// fragments through the speech guard, with VOICE_LOOKUPS on.

const fs = require('fs');
const path = require('path');
const { planLookupTurn } = require('../../src/conversation/router');
const { polishSpokenDetail } = require('../../src/conversation/dynamicSpeech');
const { lintLine } = require('../../src/knowledge/sentenceLint');
const { callbackSafeLine } = require('../../src/conversation/factSheet');
const { langOf } = require('./lib/score');
const { profiles } = require('./profiles');
const { summarizeLatency } = require('./latency');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');

function loadFixtures() {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')));
}

function forbiddenHit(speech, pattern) {
  const raw = String(pattern || '');
  const wrapped = /^\/(.+)\/$/.exec(raw);
  if (wrapped) return new RegExp(wrapped[1], 'i').test(speech);
  return speech.toLowerCase().includes(raw.toLowerCase());
}

function runFixtures() {
  const prevLookups = process.env.VOICE_LOOKUPS;
  process.env.VOICE_LOOKUPS = 'on';
  const bank = profiles();
  const failures = [];
  const brainMs = [];
  let falseDeletions = 0;
  let falseNotOnFile = 0;
  let inventedFacts = 0;
  let callbacksOnly = 0;
  let languageMismatch = 0;
  const warns = [];
  const orig = console.warn;
  console.warn = (...args) => {
    warns.push(args.join(' '));
  };
  try {
    // Warm the place index and the lookup path. Those samples are not the gate.
    for (let i = 0; i < 8; i += 1) {
      planLookupTurn({
        text: 'How much is sofa cleaning?',
        state: { conversation: {} },
        profile: bank.carry,
        language: i % 2 ? 'sw' : 'en',
        now: new Date('2026-10-19T05:00:00.000Z'),
        seed: 0,
        turnId: `warm:${i}`,
      });
    }
    for (const fix of loadFixtures()) {
      const prevHash = process.env.FACT_HASH_MODE;
      if (fix.hashMode === true) process.env.FACT_HASH_MODE = 'on';
      try {
        const profile = bank[fix.profile];
        if (!profile) {
          failures.push(`${fix.id}: unknown profile ${fix.profile}`);
          continue;
        }
        const state = { conversation: {} };
        let prevSpeech = '';
        fix.turns.forEach((turn, index) => {
        const label = `${fix.id} t${index}`;
        if (turn.model) {
          const before = String(turn.model);
          const res = polishSpokenDetail(before, {
            state,
            profile,
            language: fix.language,
            callerTurns: [turn.caller],
          });
          const speech = String(res.text || '');
          if (speech.length < before.length && (!res.dropReasons || !res.dropReasons.length)) {
            failures.push(`${label}: shorter speech with no drop reason`);
          }
          checkSpeech(label, turn, speech, fix.language, null);
          return;
        }
        const plan = planLookupTurn({
          text: turn.caller,
          state,
          profile,
          language: fix.language,
          now: new Date('2026-10-19T05:00:00.000Z'),
          seed: 0,
          turnId: `${fix.id}:${index}`,
        });
        const speech = plan?.speech || '';
        if (plan?.brainMs != null) brainMs.push(plan.brainMs);
        const polished = polishSpokenDetail(speech, {
          lookupSpeech: true,
          profile,
          language: fix.language,
          state,
        });
        if (polished.text !== speech) {
          failures.push(`${label}: lookup speech was rewritten`);
        }
        if (warns.some((line) => line.includes(speech) && /speech-filter/.test(line))) {
          failures.push(`${label}: lookup sentence landed in a drop log`);
        }
        const fault = lintLine(speech);
        if (fault) failures.push(`${label}: lint ${fault.fault} "${fault.sentence}"`);
        if (!callbackSafeLine(speech)) {
          callbacksOnly += 1;
          failures.push(`${label}: callbacks-only`);
        }
        if (prevSpeech && speech === prevSpeech && turn.allowRepeat !== true && /hours|mnafungua|saa ngapi/i.test(turn.caller)) {
          failures.push(`${label}: previous lookup speech replayed`);
        }
        checkSpeech(label, turn, speech, fix.language, plan);
        prevSpeech = speech;
      });
      } finally {
        if (prevHash == null) delete process.env.FACT_HASH_MODE;
        else process.env.FACT_HASH_MODE = prevHash;
      }
    }
  } finally {
    console.warn = orig;
    if (prevLookups == null) delete process.env.VOICE_LOOKUPS;
    else process.env.VOICE_LOOKUPS = prevLookups;
  }

  function checkSpeech(label, turn, speech, language, plan) {
    for (const need of turn.mustSay || []) {
      if (!speech.toLowerCase().includes(String(need).toLowerCase())) {
        falseDeletions += 1;
        failures.push(`${label}: missing "${need}" in "${speech}"`);
      }
    }
    for (const ban of turn.mustNotSay || []) {
      if (forbiddenHit(speech, ban)) {
        inventedFacts += 1;
        failures.push(`${label}: said forbidden ${ban} in "${speech}"`);
      }
    }
    if (turn.status && plan?.lookups?.[0] && plan.lookups[0].status !== turn.status) {
      if (turn.status === 'found') falseNotOnFile += 1;
      failures.push(`${label}: status ${plan.lookups[0].status} wanted ${turn.status}`);
    }
    if (turn.value != null && plan?.lookups?.[0] && plan.lookups[0].value !== turn.value) {
      failures.push(`${label}: value ${plan.lookups[0].value} wanted ${turn.value}`);
    }
    if (Array.isArray(turn.dropReasons) && plan) {
      const got = plan.dropReasons || [];
      if (got.length !== turn.dropReasons.length) {
        failures.push(`${label}: dropReasons ${JSON.stringify(got)}`);
      }
    }
    if (language === 'sw' && speech && langOf(speech) === 'en') {
      languageMismatch += 1;
      failures.push(`${label}: language mismatch`);
    }
  }

  const latency = summarizeLatency(brainMs);
  return {
    failures,
    brainMs,
    p95: latency.p95,
    median: latency.median,
    cap: latency.cap,
    totals: {
      cases: loadFixtures().length,
      falseDeletions,
      falseNotOnFile,
      inventedFacts,
      callbacksOnly,
      languageMismatch,
    },
  };
}

module.exports = { runFixtures, loadFixtures };
