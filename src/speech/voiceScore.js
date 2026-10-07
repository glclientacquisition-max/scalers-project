// Score a voice trace. Checks are counts. A later phase improves the
// committed baseline by making these counts fall. Missing latency is skipped.

const { analyzeCallerLanguage } = require('../conversation/language');
const { utteranceLooksIncomplete } = require('./turnTaking');

const LATENCY_BUDGET_MS = 1200;
const FIRST_PCM_P50_TARGET_MS = 1200;
const FIRST_PCM_REGRESSION_MS = 200;

const SERVICE_ASK =
  /\b(services?|huduma|mnafanya|mna\s*offer|mnaofa|mna\s*ofa|offer|unafanya|mnayofanya)\b/i;
const SERVICE_NOUN =
  /\b(clean(?:ing)?|usafi|fumig\w*|carpet|couch|sofa|mattress|upholstery|counter\s+books?|stationery|kitabu|vitabu)\b/i;
const NAME_ANSWER =
  /\b(jina lako ni|your name is|najua jina|tayari najua|speaking with)\b/i;
const NAME_ASK =
  /\b(jina lako|niambie jina|may i have your name|what(?:'s| is) your name|naongea na|ninaongea naye|am i speaking with|speaking with)\b/i;
const RESPELL = /\b[A-Za-z]{2,}(?:-[A-Za-z]{2,})+\b/g;
const NEUTRAL_ACK = /^(?:sawa|poa|asante|ndio|ndiyo|haya|okay|ok|yes|alright)[.!]?$/i;

function stage(turn, name, phase) {
  const rows = (turn?.stages || []).filter((row) => row.stage === name);
  if (!phase) return rows[rows.length - 1] || null;
  return rows.filter((row) => row.phase === phase).pop() || rows[rows.length - 1] || null;
}

function replyLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'unknown';
  if (NEUTRAL_ACK.test(raw)) return 'neutral';
  return analyzeCallerLanguage(raw).language;
}

function languagesMatch(callerLang, spokenLang) {
  if (!callerLang || callerLang === 'unknown') return true;
  if (!spokenLang || spokenLang === 'unknown' || spokenLang === 'neutral') return true;
  if (callerLang === 'mixed' || spokenLang === 'mixed') return true;
  if (callerLang === 'sheng' && (spokenLang === 'sw' || spokenLang === 'sheng')) return true;
  return callerLang === spokenLang;
}

function cutoffIndicator(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (/[—–-]\s*$/.test(raw)) return 'trailing_dash';
  if (/,\s*$/.test(raw)) return 'trailing_comma';
  if (/[—–]/.test(raw) && !/[.!?？]$/.test(raw)) return 'internal_cutoff';
  if (utteranceLooksIncomplete(raw)) return 'incomplete';
  return null;
}

function questionsOf(text) {
  return String(text || '')
    .split(/(?<=[?？])\s+/)
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((part) => part.endsWith('?') || part.endsWith('？'));
}

function looksLikeKeptAnswer(text) {
  const raw = String(text || '');
  return SERVICE_NOUN.test(raw) || NAME_ANSWER.test(raw);
}

function emptyChecks() {
  return {
    languageMismatch: 0,
    incomplete: 0,
    repeatedQuestion: 0,
    silence: 0,
    deletedAnswer: 0,
    respelling: 0,
    prematureTurn: 0,
    slow: 0,
  };
}

function scoreTurn(turn) {
  const checks = emptyChecks();
  const notes = [];
  const caller = String(turn?.caller?.text || '');
  const detected = turn?.caller?.language;
  const callerLang =
    detected && detected !== 'unknown' ? detected : analyzeCallerLanguage(caller).language;
  const model = stage(turn, 'model', 'output');
  const tts = stage(turn, 'tts');
  const end = stage(turn, 'turn_end');
  const latency = stage(turn, 'latency');
  const spoken = String(tts?.text || '');
  const modelText = String(model?.outputText || '');
  const held = end?.decision === 'hold';

  const spokenLang = replyLanguage(spoken);
  if (spoken && !languagesMatch(callerLang, spokenLang)) {
    checks.languageMismatch = 1;
    notes.push(`language ${callerLang} caller, ${spokenLang} reply`);
  }

  const modelChars = modelText.trim().length;
  const spokenChars = spoken.trim().length;
  if (!held && modelChars >= 40 && spokenChars / modelChars < 0.5) {
    checks.incomplete = 1;
    notes.push(`spoken ${spokenChars} of model ${modelChars}`);
  }

  if (!held && SERVICE_ASK.test(caller) && !SERVICE_NOUN.test(spoken)) {
    checks.incomplete = 1;
    notes.push('services question not answered');
  }

  if (!held && caller.trim().length >= 2 && !spoken.trim()) {
    checks.silence = 1;
    notes.push('silence after caller turn');
  }

  const droppedAnswer = (turn.stages || []).some(
    (row) => row.stage === 'transform' && row.dropped && looksLikeKeptAnswer(row.before)
  );
  const modelAnswerMissing =
    looksLikeKeptAnswer(modelText) && !looksLikeKeptAnswer(spoken) && modelText.trim() !== spoken.trim();
  if (!held && (droppedAnswer || modelAnswerMissing)) {
    checks.deletedAnswer = 1;
    notes.push('correct answer deleted');
  }

  const ttsLang = tts?.language || '';
  const swMouth = ttsLang === 'sw' || callerLang === 'sw' || callerLang === 'sheng';
  const respells = spoken.match(RESPELL) || [];
  if (swMouth && respells.length) {
    checks.respelling = respells.length;
    notes.push(`respelling ${respells.slice(0, 4).join(', ')}`);
  }

  const cutoff = cutoffIndicator(caller);
  if (!held && cutoff) {
    checks.prematureTurn = 1;
    notes.push(`turn end ${cutoff}`);
  }

  const pcm = latency?.callerStopToFirstTtsPcmMs;
  if (pcm != null && pcm > LATENCY_BUDGET_MS) {
    checks.slow = 1;
    notes.push(`first pcm ${pcm}ms`);
  }

  if (stage(turn, 'outcome')?.value === 'unlogged') {
    return {
      turnIndex: turn.turnIndex,
      caller,
      spoken,
      score: null,
      omit: true,
      checks: emptyChecks(),
      notes: ['raw model text was not logged'],
    };
  }

  const penalty =
    checks.languageMismatch * 20 +
    checks.incomplete * 20 +
    checks.silence * 30 +
    checks.deletedAnswer * 25 +
    Math.min(checks.respelling, 3) * 10 +
    checks.prematureTurn * 10 +
    checks.slow * 10;
  return {
    turnIndex: turn.turnIndex,
    caller,
    spoken,
    score: Math.max(0, 100 - penalty),
    checks,
    notes,
  };
}

function scoreTurns(turns = []) {
  const scored = turns.map(scoreTurn);
  const checks = emptyChecks();
  const asked = [];
  let nameAsks = 0;
  for (const turn of turns) {
    const spoken = String(stage(turn, 'tts')?.text || '');
    if (NAME_ASK.test(spoken)) nameAsks += 1;
    for (const question of questionsOf(spoken)) asked.push(question);
  }
  if (nameAsks > 1) checks.repeatedQuestion += nameAsks - 1;
  const seen = new Map();
  for (const question of asked) {
    seen.set(question, (seen.get(question) || 0) + 1);
  }
  for (const count of seen.values()) {
    if (count > 1) checks.repeatedQuestion += count - 1;
  }
  for (const turn of scored) {
    for (const key of Object.keys(checks)) {
      checks[key] += turn.checks[key] || 0;
    }
  }
  const counted = scored.filter((turn) => !turn.omit);
  const avg = counted.length
    ? counted.reduce((sum, turn) => sum + turn.score, 0) / counted.length
    : 100;
  const callPenalty = Math.min(30, checks.repeatedQuestion * 8);
  const score = Math.round((Math.max(0, avg - callPenalty) + Number.EPSILON) * 10) / 10;
  return { score, checks, turns: scored, nameAsks };
}

function historicalNotes(fixture = {}) {
  const notes = [];
  (fixture.turns || []).forEach((turn, index) => {
    const chars = turn.model?.chars;
    const emitted = turn.model?.spokenEmitted;
    const missing = turn.model?.outputText == null || turn.model.outputText === '';
    if (missing && chars > 40) {
      const emittedNote = emitted === 0 ? 'spokenEmitted was 0' : `spokenEmitted was ${emitted}`;
      notes.push(
        `turn ${index + 1}: model wrote ${chars} chars and ${emittedNote}. Raw text was not in the logs.`
      );
    }
  });
  return notes;
}

function scoreFixtureReplay(replay, fixture) {
  const body = scoreTurns(replay.turns || []);
  return {
    callId: replay.callId || fixture.callId,
    tenantId: replay.tenantId || fixture.tenantId || null,
    mode: replay.mode || 'recorded',
    score: body.score,
    checks: body.checks,
    nameAsks: body.nameAsks,
    turns: body.turns,
    historical: historicalNotes(fixture),
  };
}

function percentile(values, p) {
  const nums = (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const rank = (p / 100) * (nums.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return nums[low];
  return nums[low] + (nums[high] - nums[low]) * (rank - low);
}

/**
 * Historical first-PCM samples. Target p50 is 1200ms. A measured card
 * fails when its p50 is more than 200ms slower than the stored baseline.
 * Missing samples are not a failure.
 */
function firstPcmRegression(samples, baselineP50) {
  const p50 = percentile(samples, 50);
  const base = baselineP50 == null ? null : Number(baselineP50);
  if (p50 == null || base == null || !Number.isFinite(base)) {
    return { p50, baselineP50: base, delta: null, overTarget: false, regression: false };
  }
  const delta = p50 - base;
  return {
    p50,
    baselineP50: base,
    delta,
    overTarget: p50 > FIRST_PCM_P50_TARGET_MS,
    regression: delta > FIRST_PCM_REGRESSION_MS,
  };
}

function compareToBaseline(scorecard, baseline) {
  const failures = [];
  const calls = scorecard.calls || [];
  const expected = baseline?.calls || {};
  for (const id of Object.keys(expected)) {
    if (!calls.some((call) => call.callId === id)) failures.push(`missing seeded call ${id}`);
  }
  for (const call of calls) {
    const base = expected[call.callId];
    if (!base) {
      failures.push(`${call.callId} is not in the baseline`);
      continue;
    }
    if (call.score + 0.05 < base.score) {
      failures.push(`${call.callId} score ${call.score} < baseline ${base.score}`);
    }
    const baseChecks = base.checks || {};
    for (const [key, count] of Object.entries(call.checks || {})) {
      const allowed = baseChecks[key] ?? 0;
      if (count > allowed) {
        failures.push(`${call.callId} ${key} ${count} > baseline ${allowed}`);
      }
    }
  }
  return failures;
}

function formatSummary(scorecard) {
  const lines = ['Voice eval'];
  for (const call of scorecard.calls || []) {
    const bits = Object.entries(call.checks || {})
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${key}=${count}`)
      .join(' ');
    lines.push(`${call.callId}  ${call.score}  nameAsks=${call.nameAsks || 0}  ${bits}`.trim());
    for (const note of call.historical || []) lines.push(`  historical: ${note}`);
    for (const turn of call.turns || []) {
      if (!turn.notes?.length) continue;
      lines.push(`  #${turn.turnIndex} ${turn.notes.join('; ')}`);
    }
  }
  if (scorecard.failures?.length) {
    lines.push('Regressions:');
    for (const failure of scorecard.failures) lines.push(`  ${failure}`);
  }
  return lines.join('\n');
}

module.exports = {
  LATENCY_BUDGET_MS,
  FIRST_PCM_P50_TARGET_MS,
  FIRST_PCM_REGRESSION_MS,
  percentile,
  firstPcmRegression,
  scoreTurn,
  scoreTurns,
  scoreFixtureReplay,
  compareToBaseline,
  formatSummary,
  historicalNotes,
  languagesMatch,
  cutoffIndicator,
};
