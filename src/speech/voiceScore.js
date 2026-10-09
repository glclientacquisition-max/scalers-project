// Score a voice trace. Checks are counts. A later phase improves the
// committed baseline by making these counts fall. Missing latency is skipped.

const {
  analyzeCallerLanguage,
  dominantSonioxLanguage,
  isBackchannel,
  ENGLISH_JOB_LOANWORDS,
} = require('../conversation/language');
const { utteranceLooksIncomplete } = require('./turnTaking');
const { callChecks } = require('./callChecks');

const LATENCY_BUDGET_MS = 1200;

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

function stages(turn, name, phase) {
  const rows = (turn?.stages || []).filter((row) => row.stage === name);
  if (!phase) return rows;
  const phased = rows.filter((row) => row.phase === phase);
  return phased.length ? phased : rows;
}

function stage(turn, name, phase) {
  const rows = stages(turn, name, phase);
  return rows[rows.length - 1] || null;
}

// The structured mouth's model output is a JSON envelope
// ({ lang, intent, facts_used, say: [...], tool?, end_call? }); only say[] is
// meant to be spoken. Scoring the raw envelope made every short reply look
// "incomplete" (staging 5bbb0871: all 8 flags were the JSON wrapper).
function structuredSay(raw) {
  const text = String(raw || '').trim();
  if (!text.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.say)) {
      return parsed.say.filter((piece) => typeof piece === 'string').join(' ');
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.say === 'string') return parsed.say;
    return null;
  } catch {
    // A cut-off stream: take the complete say[] strings that arrived.
    const at = text.search(/"say"\s*:\s*\[/);
    if (at < 0) return null;
    const tail = text.slice(at).replace(/^"say"\s*:\s*\[/, '');
    const pieces = [];
    const re = /\s*"((?:[^"\\]|\\.)*)"\s*(,|\])/gy;
    let m;
    while ((m = re.exec(tail))) {
      try {
        pieces.push(JSON.parse(`"${m[1]}"`));
      } catch {
        break;
      }
      if (m[2] === ']') break;
    }
    return pieces.join(' ');
  }
}

function modelProse(text) {
  const say = structuredSay(text);
  return String(say != null ? say : text || '')
    .replace(/###TOOL###[\s\S]*?###ENDTOOL###/gi, ' ')
    .replace(/###ENDCALL###/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function spokenText(turn) {
  return stages(turn, 'tts')
    .filter((row) => row.filler !== true)
    .map((row) => String(row.text || '').trim())
    .filter(Boolean)
    .join(' ');
}

function normalizeSpeech(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionSources(turn) {
  const blobs = [];
  const spokenNorm = normalizeSpeech(spokenText(turn));
  const prose = modelProse(stage(turn, 'model', 'output')?.outputText || '');
  if (prose && spokenNorm) {
    const kept = questionsOf(prose).filter((question) =>
      spokenNorm.includes(normalizeSpeech(question))
    );
    if (kept.length) blobs.push(kept.join(' '));
  }
  for (const row of stages(turn, 'tts')) {
    if (row.before) blobs.push(String(row.before));
  }
  if (!blobs.length) {
    const spoken = spokenText(turn);
    if (spoken) blobs.push(spoken);
  }
  return blobs;
}

function uniqueQuestions(turn) {
  const seen = new Set();
  const out = [];
  for (const blob of questionSources(turn)) {
    for (const question of questionsOf(blob)) {
      if (NAME_ASK.test(question)) continue;
      const key = normalizeSpeech(question);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function asksName(turn) {
  return questionSources(turn).some((blob) => NAME_ASK.test(blob));
}

function sonioxTags(turn) {
  const tags = [];
  for (const row of stages(turn, 'stt')) {
    for (const token of row.tokens || []) {
      if (token?.language) tags.push(token.language);
    }
  }
  return tags;
}

function callerLanguage(turn) {
  // Soniox wins when any tag is present. Do not also run the keyword fallback.
  const stored = turn?.caller?.soniox || stage(turn, 'language')?.soniox || null;
  if (stored && stored !== 'unknown') return stored;
  const voted = dominantSonioxLanguage(sonioxTags(turn));
  if (voted) return voted;
  const explicit = turn?.caller?.detected;
  const stageDetected = stage(turn, 'language')?.detected;
  const detected = explicit || stageDetected || null;
  if (detected && detected !== 'unknown') return detected;
  if (detected === 'unknown') {
    const analyzed = analyzeCallerLanguage(String(turn?.caller?.text || '')).language;
    return analyzed && analyzed !== 'unknown' ? analyzed : 'unknown';
  }
  const recorded = turn?.caller?.language;
  if (recorded && recorded !== 'unknown') return recorded;
  return analyzeCallerLanguage(String(turn?.caller?.text || '')).language;
}

function questionMissing(modelText, spoken) {
  const spokenNorm = normalizeSpeech(spoken);
  return questionsOf(modelProse(modelText)).some((question) => {
    const body = normalizeSpeech(question);
    return body.length > 0 && !spokenNorm.includes(body);
  });
}

function replyLatencyMs(turn, latency) {
  if (!latency) return null;
  if (latency.firstReplyPcmMs != null && Number.isFinite(Number(latency.firstReplyPcmMs))) {
    return Number(latency.firstReplyPcmMs);
  }
  const hasFiller = (turn?.stages || []).some((row) => row.stage === 'filler');
  const spoken = spokenText(turn);
  if (hasFiller && !spoken.trim()) return null;
  const pcm = latency.callerStopToFirstTtsPcmMs;
  return pcm == null || !Number.isFinite(Number(pcm)) ? null : Number(pcm);
}

function stripJobLoanwords(text) {
  let raw = String(text || '');
  for (const word of ENGLISH_JOB_LOANWORDS) {
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    raw = raw.replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ');
  }
  return raw.replace(/\s+/g, ' ').trim();
}

function replyLanguage(text) {
  const raw = String(text || '').trim();
  if (!raw) return 'unknown';
  if (NEUTRAL_ACK.test(raw)) return 'neutral';
  const analyzed = analyzeCallerLanguage(raw);
  if (analyzed.language !== 'en') return analyzed.language;
  // One English loanword does not make a Kiswahili reply English.
  const residue = stripJobLoanwords(raw);
  const residueWords = residue.split(/\s+/).filter((word) => word.length > 1);
  if (!residueWords.length) return 'unknown';
  const rest = analyzeCallerLanguage(residue);
  if (rest.language === 'unknown' && !(rest.scores && rest.scores.en > 0)) return 'sw';
  return 'en';
}

const FACT_DROP_REASONS = new Set(['unbound_place', 'unsaid_number']);

function factSentenceDropped(turn) {
  return (turn?.stages || []).some((row) => {
    if (row.stage !== 'transform') return false;
    if (FACT_DROP_REASONS.has(row.reason)) return true;
    return (Array.isArray(row.dropReasons) ? row.dropReasons : []).some((reason) =>
      FACT_DROP_REASONS.has(reason)
    );
  });
}

function lateTokenCut(turn) {
  const late = (turn?.stages || []).some(
    (row) =>
      row.stage === 'turn_end' &&
      ((row.decision === 'ignore' && row.reason === 'grace') ||
        (row.decision === 'hold' && row.reason === 'late_final'))
  );
  if (!late) return null;
  const caller = normalizeSpeech(turn?.caller?.text);
  const extras = [];
  for (const row of stages(turn, 'stt')) {
    if (row.kind !== 'final') continue;
    const text = normalizeSpeech(row.text);
    if (text && !caller.includes(text)) extras.push(String(row.text || '').trim());
  }
  if (extras.length) return extras[extras.length - 1];
  const merged = (turn?.stages || []).some(
    (row) => row.stage === 'turn_end' && row.reason === 'late_final'
  );
  return merged ? 'late token' : null;
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
    .split(/(?<=[.!?？])\s+/)
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((part) => part.endsWith('?') || part.endsWith('？'));
}

function looksLikeKeptAnswer(text) {
  const raw = String(text || '');
  return SERVICE_NOUN.test(raw) || NAME_ANSWER.test(raw);
}

function appendSpeakNotes(turn, notes) {
  for (const row of turn?.stages || []) {
    if (row.stage === 'speak_packet') {
      notes.push(
        row.committed
          ? `speak packet ${row.tier} ${row.outcome} committed`
          : `speak packet ${row.tier || 'private'} ${row.outcome || ''} withheld`.trim()
      );
    } else if (row.stage === 'speak_slots') {
      const count = Array.isArray(row.slots) ? row.slots.length : 0;
      notes.push(`speak slots ${row.action} ${count}`);
    }
  }
}

// A caller closing ("that's all", "asante", "hiyo tu", "bye").
const CALLER_CLOSING =
  /^(?:(?:okay|ok|alright|sawa|so|um|uh|yeah|yes|no|basi)[,.\s]+)*(?:that'?s (?:all|it)|that is (?:all|it)|bye(?: bye)?|goodbye|good bye|kwaheri|tutaonana|see you|thank you(?: so much| very much)?|thanks(?: a lot)?|asante(?: sana)?|hiyo tu|ni hiyo tu|ni hayo tu|hayo tu|baadaye basi|nothing else|hakuna kingine|i'?m done)(?:[,.!\s]+(?:that'?s all|bye|goodbye|kwaheri|thank you|thanks|asante(?: sana)?|baadaye basi|hiyo tu|ni hayo tu))*[.!\s]*$/i;

/**
 * The call ended with this turn because the caller left: Voice traced the
 * call as over (stage call_over / turn_end reason call_over), or the caller
 * closed and nothing after it was spoken.
 */
function callerLeftAfter(turn) {
  const rows = turn?.stages || [];
  if (rows.some((row) => row.stage === 'call_over' || (row.stage === 'turn_end' && row.reason === 'call_over'))) {
    return true;
  }
  return CALLER_CLOSING.test(String(turn?.caller?.text || '').trim());
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

/**
 * @param {object} turn
 * @param {{ callerLeft?: boolean }} [opts] callerLeft: the last turn of a call
 *   the caller ended (callerLeftAfter); its missing reply is not silence.
 */
function scoreTurn(turn, opts = {}) {
  const checks = emptyChecks();
  const notes = [];
  const caller = String(turn?.caller?.text || '');
  const callerLang = callerLanguage(turn);
  const model = stage(turn, 'model', 'output');
  const ttsRows = stages(turn, 'tts').filter((row) => row.filler !== true);
  const tts = ttsRows[ttsRows.length - 1] || null;
  const latency = stage(turn, 'latency');
  const outcome = stage(turn, 'outcome')?.value || '';
  const spoken = spokenText(turn);
  const modelText = modelProse(model?.outputText || '');
  const turnEnds = stages(turn, 'turn_end');
  const flushed = turnEnds.some((row) => row.decision === 'flush');
  const held =
    !flushed &&
    turnEnds.some((row) => row.decision === 'hold' && row.reason !== 'late_final');

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

  const skipped =
    outcome === 'skip' ||
    (turn.stages || []).some((row) => row.stage === 'turn_end' && row.decision === 'skip');
  if (
    !held &&
    !skipped &&
    !isBackchannel(caller) &&
    outcome !== 'barge_in' &&
    caller.trim().length >= 2 &&
    !spoken.trim()
  ) {
    if (opts.callerLeft) {
      notes.push('caller hung up; no reply owed');
    } else {
      checks.silence = 1;
      notes.push('silence after caller turn');
    }
  }

  const droppedAnswer = (turn.stages || []).some(
    (row) => row.stage === 'transform' && row.dropped && looksLikeKeptAnswer(row.before)
  );
  const droppedQuestion = (turn.stages || []).some(
    (row) => row.stage === 'transform' && row.dropped && questionMissing(row.before, spoken)
  );
  const modelAnswerMissing =
    looksLikeKeptAnswer(modelText) && !looksLikeKeptAnswer(spoken) && modelText.trim() !== spoken.trim();
  const modelQuestionMissing = questionMissing(model?.outputText || '', spoken);
  const droppedFact = factSentenceDropped(turn);
  if (!held && (droppedAnswer || droppedQuestion || modelAnswerMissing || modelQuestionMissing || droppedFact)) {
    checks.deletedAnswer = 1;
    notes.push(droppedFact ? 'coverage or price sentence deleted' : 'correct answer deleted');
  }

  const ttsLang = tts?.language || '';
  const swMouth = ttsLang === 'sw' || callerLang === 'sw' || callerLang === 'sheng';
  const respells = spoken.match(RESPELL) || [];
  if (swMouth && respells.length) {
    checks.respelling = respells.length;
    notes.push(`respelling ${respells.slice(0, 4).join(', ')}`);
  }

  const cutoff = cutoffIndicator(caller);
  const lateToken = lateTokenCut(turn);
  if (!held && (cutoff || lateToken)) {
    checks.prematureTurn = 1;
    if (lateToken) notes.push(`late token ${lateToken}`);
    else notes.push(`turn end ${cutoff}`);
  }

  const pcm = replyLatencyMs(turn, latency);
  if (pcm != null && pcm > LATENCY_BUDGET_MS) {
    checks.slow = 1;
    notes.push(`first reply pcm ${pcm}ms`);
  }

  appendSpeakNotes(turn, notes);

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

/**
 * @param {object[]} turns
 * @param {{ callAt?: string, openVisits?: object[], agentName?: string, businessName?: string }} [ctx]
 *   optional call facts for the call-level checks (src/speech/callChecks.js).
 */
function scoreTurns(turns = [], ctx = {}) {
  // The caller's last words before hanging up get no reply: that is not
  // silence (HD_ceba9d9b3f37 t6 "That's all." after the hangup).
  const last = turns.length - 1;
  const scored = turns.map((turn, i) =>
    scoreTurn(turn, { callerLeft: i === last && callerLeftAfter(turn) })
  );
  const checks = emptyChecks();
  const asked = [];
  const nameAskTurns = [];
  let nameAsks = 0;
  for (const turn of turns) {
    if (asksName(turn)) {
      nameAsks += 1;
      if (turn.turnIndex != null) nameAskTurns.push(turn.turnIndex);
    }
    for (const question of uniqueQuestions(turn)) asked.push(question);
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
  // Visit read, Nairobi date, and name lock are call-level (callChecks.js).
  const call = callChecks(turns, ctx || {});
  for (const [key, count] of Object.entries(call.counts)) checks[key] = count;
  for (const rows of Object.values(call.findings)) {
    for (const row of rows) {
      const hit = scored.find((turn) => turn.turnIndex != null && turn.turnIndex === row.turnIndex);
      if (hit) hit.notes = [...(hit.notes || []), row.note];
    }
  }
  const callPenalty = Math.min(30, checks.repeatedQuestion * 8) + call.penalty;
  const score = Math.round((Math.max(0, avg - callPenalty) + Number.EPSILON) * 10) / 10;
  return { score, checks, turns: scored, nameAsks, nameAskTurns, callFindings: call.findings };
}

const CHECK_WEIGHT = {
  silence: 30,
  deletedAnswer: 25,
  languageMismatch: 20,
  incomplete: 20,
  prematureTurn: 10,
  slow: 10,
  visitMissed: 20,
  dateWrong: 20,
  nameLock: 15,
  ignoredFile: 25,
  holdMissed: 15,
  falseMove: 20,
  swTimeWrong: 15,
};

const CHECK_LINE = {
  silence: 'Silence after a caller turn',
  deletedAnswer: 'A correct answer was deleted',
  languageMismatch: 'Reply language did not match the caller',
  incomplete: 'The answer was incomplete',
  prematureTurn: 'The caller was cut off',
  slow: 'First audio was late',
  respelling: 'An English-style respelling was spoken',
  repeatedQuestion: 'A question was repeated',
  visitMissed: 'Open visits were not read out',
  dateWrong: 'A spoken day or date was wrong for Nairobi',
  nameLock: 'The caller name did not stay locked',
  ignoredFile: 'The caller file was ignored',
  holdMissed: 'An open hold the caller asked about was not read',
  falseMove: 'Claimed a move, but a new visit was made and the old one is still open',
  swTimeWrong: 'A Kiswahili time disagreed with the stored time',
};

function turnsForCheck(scored, key) {
  return (scored || [])
    .filter((turn) => (turn.checks?.[key] || 0) > 0 && turn.turnIndex != null)
    .map((turn) => turn.turnIndex);
}

function diagnoseCall(card = {}) {
  const checks = card.checks || {};
  const ranked = [];
  for (const [key, weight] of Object.entries(CHECK_WEIGHT)) {
    const count = checks[key] || 0;
    if (count > 0) {
      const callRows = card.callFindings?.[key];
      const turns = callRows
        ? [...new Set(callRows.map((row) => row.turnIndex).filter((index) => index != null))]
        : turnsForCheck(card.turns, key);
      ranked.push({ key, points: count * weight, turns });
    }
  }
  const respell = checks.respelling || 0;
  if (respell > 0) {
    ranked.push({
      key: 'respelling',
      points: Math.min(respell, 3) * 10,
      turns: turnsForCheck(card.turns, 'respelling'),
    });
  }
  const repeats = checks.repeatedQuestion || 0;
  if (repeats > 0) {
    ranked.push({
      key: 'repeatedQuestion',
      points: Math.min(30, repeats * 8),
      turns: card.nameAsks > 1 ? card.nameAskTurns || [] : [],
    });
  }
  ranked.sort((a, b) => b.points - a.points);
  if (!ranked.length) return 'No failed checks.';
  const worst = ranked[0];
  if (worst.key === 'repeatedQuestion' && card.nameAsks > 1) {
    const where = worst.turns.length ? ` (turns ${worst.turns.join(', ')})` : '';
    return `Name asked ${card.nameAsks} times${where}`;
  }
  const where = worst.turns.length ? ` (turns ${worst.turns.join(', ')})` : '';
  return `${CHECK_LINE[worst.key] || worst.key}${where}`;
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
  modelProse,
  LATENCY_BUDGET_MS,
  scoreTurn,
  scoreTurns,
  callerLeftAfter,
  diagnoseCall,
  scoreFixtureReplay,
  compareToBaseline,
  formatSummary,
  historicalNotes,
  languagesMatch,
  cutoffIndicator,
};
