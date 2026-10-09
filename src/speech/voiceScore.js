// Score a voice trace. Checks are counts. A later phase improves the
// committed baseline by making these counts fall. Missing latency is skipped.

const {
  analyzeCallerLanguage,
  dominantSonioxLanguage,
  isBackchannel,
  ENGLISH_JOB_LOANWORDS,
} = require('../conversation/language');
const { utteranceLooksIncomplete } = require('./turnTaking');

const LATENCY_BUDGET_MS = 1200;

// Mouth checks (Phase 1 top-up). They are counted next to the legacy checks
// and do not change the legacy score, so existing baselines keep their numbers.
const MONOLOGUE_MAX_SECONDS = 25;
const MONOLOGUE_MAX_SENTENCES = 3;
// Phone-paced speech is about 2.6 words a second (HD_015b t8: ~90 words in 29.5 s).
const WORDS_PER_SECOND = 2.6;
const SPOKEN_CHAR = /[\p{L}\p{N}]/u;
const LOST_TURN_REASONS = new Set(['thinking_continuation', 'weak_thinking_interrupt']);
// Transforms that change pronunciation or spacing only. They never count as
// replacing an answer.
const NORMALIZE_TRANSFORMS = new Set(['tts_normalize', 'speech_boundary', 'structured_boundary']);

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

const { finalCarriesContent } = require('./turnTaking');

// A caller final with content whose turn-taking decision threw it away
// (HD_054e4f7ff253 t3: "Unawashangaa apartment?" ignored as
// thinking_continuation). Echo and duplicate drops are the agent's own audio.
const LOST_FINAL_DECISIONS = new Set(['ignore', 'skip', 'drop']);
const LOST_FINAL_EXEMPT = new Set(['echo', 'duplicate', 'empty']);

function lostCallerFinals(turn) {
  const rows = Array.isArray(turn?.stages) ? turn.stages : [];
  const lost = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (row?.stage !== 'stt' || row.kind !== 'final') continue;
    const text = String(row.text || '').trim();
    if (!finalCarriesContent(text)) continue;
    let end = null;
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[j]?.stage === 'stt' && rows[j].kind === 'final') break;
      if (rows[j]?.stage === 'turn_end') {
        end = rows[j];
        break;
      }
    }
    if (!end || !LOST_FINAL_DECISIONS.has(end.decision)) continue;
    if (LOST_FINAL_EXEMPT.has(end.reason)) continue;
    lost.push({ text, reason: end.reason || end.decision });
  }
  return lost;
}

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

function modelProse(text) {
  return String(text || '')
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
        // A grace final that is now kept still means the turn closed early.
        (row.decision === 'queue' && row.reason === 'kept_grace') ||
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

function emptyMouthChecks() {
  return {
    gluedPiece: 0,
    letterlessPiece: 0,
    monologue: 0,
    lostTurn: 0,
    stackedQuestion: 0,
    replacedAnswer: 0,
  };
}

function ttsPieces(turn) {
  return stages(turn, 'tts').filter((row) => row.filler !== true);
}

function wireOf(row) {
  if (row && typeof row.wire === 'string') return row.wire;
  return String(row?.text || '');
}

/**
 * Pieces of one Soniox stream that touch with no word gap ("windowWhat").
 * A row with `wire` is the exact text sent. A legacy row has only the
 * trimmed text that pushText sent, so a second piece in the same turn is
 * glued unless it carries its own leading space (inferred: legacy traces do
 * not record the stream id).
 */
function gluedPieces(turn) {
  const rows = ttsPieces(turn);
  const glued = [];
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const row = rows[i];
    if (prev.stream && row.stream && prev.stream !== row.stream) continue;
    if (row.streamStart === true) continue;
    const prevWire = wireOf(prev);
    const wire = wireOf(row);
    if (!prevWire.trim() || !wire.trim()) continue;
    const prevEnd = prevWire.slice(-1);
    const head = wire.slice(0, 1);
    if (SPOKEN_CHAR.test(prevEnd) && SPOKEN_CHAR.test(head)) {
      glued.push(`${prevWire.trim().split(/\s+/).pop()}${wire.trim().split(/\s+/)[0]}`);
    }
  }
  return glued;
}

function letterlessPieces(turn) {
  return ttsPieces(turn)
    .map((row) => wireOf(row))
    .filter((wire) => wire.trim() && !SPOKEN_CHAR.test(wire));
}

function sentenceCount(text) {
  return String(text || '')
    .split(/(?<=[.!?？])\s+/)
    .map((part) => part.trim())
    .filter((part) => SPOKEN_CHAR.test(part)).length;
}

function monologueOf(turn) {
  // A barged reply still played: replay records it as a `played` row.
  const rows = ttsPieces(turn).concat(stages(turn, 'played'));
  if (!rows.length) return null;
  const spoken = rows.map((row) => String(row.text || '').trim()).filter(Boolean).join(' ');
  const words = spoken.split(/\s+/).filter((word) => SPOKEN_CHAR.test(word)).length;
  const measured = rows.reduce((sum, row) => sum + (Number(row.durationMs) || 0), 0);
  const seconds = measured > 0 ? measured / 1000 : words / WORDS_PER_SECOND;
  const sentences = rows.reduce(
    (sum, row) => sum + Math.max(1, sentenceCount(row.before != null ? row.before : row.text)),
    0
  );
  if (seconds > MONOLOGUE_MAX_SECONDS || sentences > MONOLOGUE_MAX_SENTENCES) {
    return { seconds: Math.round(seconds * 10) / 10, sentences, measured: measured > 0 };
  }
  return null;
}

function lostFinals(turn) {
  const rows = turn?.stages || [];
  const lost = [];
  rows.forEach((row, index) => {
    if (row.stage !== 'turn_end') return;
    if (row.decision !== 'ignore' && row.decision !== 'drop') return;
    if (!LOST_TURN_REASONS.has(row.reason)) return;
    if (row.queued === true) return;
    let text = String(row.text || '').trim();
    if (!text) {
      for (let j = index - 1; j >= 0; j -= 1) {
        if (rows[j].stage === 'stt' && rows[j].kind === 'final') {
          text = String(rows[j].text || '').trim();
          break;
        }
      }
    }
    if (!text || isBackchannel(text)) return;
    const words = normalizeSpeech(text).split(' ').filter(Boolean);
    if (words.length >= 2 || /[?？]/.test(text)) lost.push(text);
  });
  return lost;
}

function spokenQuestions(turn) {
  const seen = new Set();
  const out = [];
  for (const row of ttsPieces(turn)) {
    const source = row.before != null ? row.before : row.text;
    for (const question of questionsOf(source)) {
      const key = normalizeSpeech(question);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(question);
    }
  }
  return out;
}

function contentWords(text) {
  return normalizeSpeech(text)
    .split(' ')
    .filter((word) => word.length > 2);
}

function replacedAnswers(turn) {
  const out = [];
  for (const row of turn?.stages || []) {
    if (row.stage !== 'transform' || row.dropped) continue;
    if (NORMALIZE_TRANSFORMS.has(row.name)) continue;
    const before = String(row.before || '');
    const after = String(row.after || '');
    if (!after.trim()) continue;
    const substantive = looksLikeKeptAnswer(before) || /\d/.test(before);
    if (!substantive) continue;
    const beforeWords = contentWords(before);
    if (beforeWords.length < 5) continue;
    const afterSet = new Set(contentWords(after));
    const kept = beforeWords.filter((word) => afterSet.has(word)).length;
    if (kept / beforeWords.length < 0.5) out.push({ name: row.name, reason: row.reason });
  }
  return out;
}

function scoreMouthTurn(turn) {
  const checks = emptyMouthChecks();
  const notes = [];
  const glued = gluedPieces(turn);
  if (glued.length) {
    checks.gluedPiece = glued.length;
    notes.push(`glued ${glued.slice(0, 3).join(', ')}`);
  }
  const letterless = letterlessPieces(turn);
  if (letterless.length) {
    checks.letterlessPiece = letterless.length;
    notes.push(`letterless piece ${JSON.stringify(letterless[0])}`);
  }
  const mono = monologueOf(turn);
  if (mono) {
    checks.monologue = 1;
    notes.push(`monologue ${mono.sentences} sentences ~${mono.seconds}s`);
  }
  const lost = lostFinals(turn);
  if (lost.length) {
    checks.lostTurn = lost.length;
    notes.push(`lost caller turn ${JSON.stringify(lost[0])}`);
  }
  const questions = spokenQuestions(turn);
  if (questions.length > 1) {
    checks.stackedQuestion = 1;
    notes.push(`stacked questions ${questions.length}`);
  }
  const replaced = replacedAnswers(turn);
  if (replaced.length) {
    checks.replacedAnswer = replaced.length;
    notes.push(`answer replaced by ${replaced[0].name}${replaced[0].reason ? ` (${replaced[0].reason})` : ''}`);
  }
  return { checks, notes };
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
    lostCallerFinal: 0,
  };
}

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

  // Structured mouth: a dropped second question is intentional, and a
  // sentence answered from data counts at the length of the data line.
  const modelChars = Math.max(
    0,
    (turn.stages || [])
      .filter((row) => row.stage === 'transform')
      .reduce((chars, row) => {
        if (row.reason === 'stacked_question') return chars - String(row.before || '').trim().length - 1;
        if (row.name === 'structured_verify' && String(row.after || '').trim()) {
          return chars - String(row.before || '').trim().length + String(row.after).trim().length;
        }
        return chars;
      }, modelText.trim().length)
  );
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
    checks.silence = 1;
    notes.push('silence after caller turn');
  }

  const droppedAnswer = (turn.stages || []).some(
    (row) => row.stage === 'transform' && row.dropped && looksLikeKeptAnswer(row.before)
  );
  // The structured mouth keeps one question per reply. A second question it
  // dropped on purpose (reason stacked_question) is not a deleted answer.
  const stackedDrops = (turn.stages || [])
    .filter((row) => row.stage === 'transform' && row.reason === 'stacked_question')
    .map((row) => normalizeSpeech(row.before));
  const droppedQuestion = (turn.stages || []).some(
    (row) =>
      row.stage === 'transform' &&
      row.dropped &&
      row.reason !== 'stacked_question' &&
      questionMissing(row.before, spoken)
  );
  const modelAnswerMissing =
    looksLikeKeptAnswer(modelText) && !looksLikeKeptAnswer(spoken) && modelText.trim() !== spoken.trim();
  const modelQuestionMissing = stackedDrops.length
    ? questionsOf(modelProse(model?.outputText || '')).some((question) => {
        const body = normalizeSpeech(question);
        return body.length > 0 && !stackedDrops.includes(body) && !normalizeSpeech(spoken).includes(body);
      })
    : questionMissing(model?.outputText || '', spoken);
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

  // A dropped caller question counts unless that text reached a caller turn
  // (this one or a later one), i.e. it was answered after all.
  const reached = normalizeSpeech(
    [turn?.caller?.text || '', ...(Array.isArray(opts.laterCallerTexts) ? opts.laterCallerTexts : [])].join(' ')
  );
  const lost = lostCallerFinals(turn).filter(
    (row) => !reached.includes(normalizeSpeech(row.text))
  );
  if (lost.length) {
    checks.lostCallerFinal = 1;
    notes.push(`caller final dropped (${lost[0].reason}): ${lost[0].text}`);
  }

  appendSpeakNotes(turn, notes);
  const mouth = scoreMouthTurn(turn);

  if (stage(turn, 'outcome')?.value === 'unlogged') {
    return {
      turnIndex: turn.turnIndex,
      caller,
      spoken,
      score: null,
      omit: true,
      checks: emptyChecks(),
      mouth: mouth.checks,
      notes: ['raw model text was not logged', ...mouth.notes],
    };
  }
  // Structured replay of a MOCK whose recorded legacy text is in another
  // language than the lock: only a live structured recording can say what
  // the model would write, so the turn is not scored either way.
  if (stage(turn, 'outcome')?.value === 'needs_recording') {
    return {
      turnIndex: turn.turnIndex,
      caller,
      spoken,
      score: null,
      omit: true,
      checks: emptyChecks(),
      mouth: mouth.checks,
      notes: ['needs a live structured recording (mock language differs from the lock)', ...mouth.notes],
    };
  }

  const penalty =
    checks.languageMismatch * 20 +
    checks.incomplete * 20 +
    checks.silence * 30 +
    checks.deletedAnswer * 25 +
    Math.min(checks.respelling, 3) * 10 +
    checks.prematureTurn * 10 +
    checks.slow * 10 +
    checks.lostCallerFinal * 25;
  return {
    turnIndex: turn.turnIndex,
    caller,
    spoken,
    score: Math.max(0, 100 - penalty),
    checks,
    mouth: mouth.checks,
    notes: notes.concat(mouth.notes),
  };
}

function scoreTurns(turns = []) {
  const callerTexts = turns.map((turn) => String(turn?.caller?.text || ''));
  const scored = turns.map((turn, index) =>
    scoreTurn(turn, { laterCallerTexts: callerTexts.slice(index + 1) })
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
  const mouth = emptyMouthChecks();
  for (const turn of scored) {
    for (const key of Object.keys(checks)) {
      checks[key] += turn.checks[key] || 0;
    }
    for (const key of Object.keys(mouth)) {
      mouth[key] += turn.mouth?.[key] || 0;
    }
  }
  const counted = scored.filter((turn) => !turn.omit);
  const avg = counted.length
    ? counted.reduce((sum, turn) => sum + turn.score, 0) / counted.length
    : 100;
  const callPenalty = Math.min(30, checks.repeatedQuestion * 8);
  const score = Math.round((Math.max(0, avg - callPenalty) + Number.EPSILON) * 10) / 10;
  return { score, checks, mouth, turns: scored, nameAsks, nameAskTurns };
}

const CHECK_WEIGHT = {
  silence: 30,
  lostCallerFinal: 25,
  deletedAnswer: 25,
  languageMismatch: 20,
  incomplete: 20,
  prematureTurn: 10,
  slow: 10,
};

const CHECK_LINE = {
  silence: 'Silence after a caller turn',
  lostCallerFinal: 'A caller question was dropped',
  deletedAnswer: 'A correct answer was deleted',
  languageMismatch: 'Reply language did not match the caller',
  incomplete: 'The answer was incomplete',
  prematureTurn: 'The caller was cut off',
  slow: 'First audio was late',
  respelling: 'An English-style respelling was spoken',
  repeatedQuestion: 'A question was repeated',
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
      ranked.push({ key, points: count * weight, turns: turnsForCheck(card.turns, key) });
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
    mouth: body.mouth,
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
    // Mouth checks gate only once a baseline has recorded them.
    if (base.mouth && call.mouth) {
      for (const [key, count] of Object.entries(call.mouth)) {
        const allowed = base.mouth[key] ?? 0;
        if (count > allowed) {
          failures.push(`${call.callId} mouth.${key} ${count} > baseline ${allowed}`);
        }
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
    const mouthBits = Object.entries(call.mouth || {})
      .filter(([, count]) => count > 0)
      .map(([key, count]) => `${key}=${count}`)
      .join(' ');
    if (mouthBits) lines.push(`  mouth: ${mouthBits}`);
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
  MONOLOGUE_MAX_SECONDS,
  MONOLOGUE_MAX_SENTENCES,
  scoreMouthTurn,
  emptyMouthChecks,
  scoreTurn,
  scoreTurns,
  lostCallerFinals,
  diagnoseCall,
  scoreFixtureReplay,
  compareToBaseline,
  formatSummary,
  historicalNotes,
  languagesMatch,
  cutoffIndicator,
};
