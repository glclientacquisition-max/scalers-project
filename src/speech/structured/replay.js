// Structured mouth for the replay harness (replayVoice --mouth structured).
// A Gemini turn replays a structured recording through the real engine
// (turn.js) and the real TTS boundary (speechBoundary.js). The recording is,
// in order of preference: a real `--live --record` capture, a hand-checked
// sidecar mock, or an inline mock built from the turn's recorded legacy text
// (mockLabel.js). Canned and early-return turns keep their text but go through
// the structured boundary, as speakText does with the flag on.

const { runStructuredTurn } = require('./turn');
const { buildFactTable } = require('./facts');
const { lockReplyLanguage } = require('./languageLock');
const { prepareStructuredPiece } = require('./speechBoundary');
const { mockStructuredReply, mockTrimmed } = require('./mockLabel');
const { chunksFromJson, chunksFromTexts, streamOf } = require('./mockStream');
const { correctionTurn } = require('./schema');
const { analyzeCallerLanguage, createLanguageState, resolveLanguageState } = require('../../conversation/language');

function sonioxTags(turn) {
  if (Array.isArray(turn?.sonioxTags)) return turn.sonioxTags;
  return turn?.soniox ? [turn.soniox, turn.soniox, turn.soniox] : [];
}

function recordingFor(turnIndex, sidecar) {
  const row = sidecar?.turns?.[String(turnIndex)];
  return row && Array.isArray(row.attempts) && row.attempts.length ? row : null;
}

/**
 * @returns {Promise<{ spoken: string, before: string, ttsLanguage: string, stages: object[],
 *   canned: object|null, pieces: object[], modelProse: string, raw: string, structured: object }>}
 */
async function speakStructured({ turn, turnIndex, ctx, speech, modelText, canned, sidecar }) {
  const caller = String(turn.caller || '');
  // Same order as server.js: lock from this turn's tags against the sticky
  // state, then move the sticky state with this turn's evidence.
  const tags = sonioxTags(turn);
  const langState = ctx.structuredLangState || createLanguageState();
  const lock = lockReplyLanguage({ text: caller, tokenLanguages: tags, state: langState });
  ctx.structuredLangState = resolveLanguageState(langState, analyzeCallerLanguage(caller, { tokenLanguages: tags }));
  const profile = speech.profile;
  const table = buildFactTable(profile, { state: ctx.state, speakerBound: false });
  const stages = [];
  const pieces = [];

  if (!modelText) {
    if (!canned?.text) {
      return { spoken: '', before: '', ttsLanguage: lock.lang, stages, canned: null, pieces, modelProse: '', raw: '', structured: null, lock };
    }
    const prepared = prepareStructuredPiece(canned.text, { callLanguage: speech.language, first: true });
    if (prepared.wire) {
      pieces.push({ text: prepared.text, wire: prepared.wire, before: canned.text, language: prepared.language });
    }
    return {
      spoken: prepared.text,
      before: canned.text,
      ttsLanguage: prepared.language,
      stages,
      canned,
      pieces,
      modelProse: '',
      raw: '',
      structured: null,
      lock,
    };
  }

  const recording = recordingFor(turnIndex, sidecar);
  let source = 'inline_mock';
  let attempts;
  let trimmed = [];
  if (recording) {
    source = recording.mock === false || sidecar?.mock === false ? 'recorded' : 'sidecar_mock';
    attempts = recording.attempts.map((attempt) =>
      Array.isArray(attempt.chunks)
        ? chunksFromTexts(attempt.chunks, { thoughtSignature: attempt.thoughtSignature ? 'recorded-signature' : '' })
        : chunksFromJson(attempt.value)
    );
  } else {
    const value = mockStructuredReply(modelText, { table, locked: lock.lang });
    trimmed = mockTrimmed(modelText);
    attempts = [chunksFromJson(value)];
  }
  const callerText = ctx.callerTurns.concat(caller).join(' ');
  const live = ctx.structuredLive || null;
  if (live) {
    // --live --record: the real API under responseSchema; each attempt's raw
    // chunk texts are kept so the run can be replayed offline later.
    source = 'live';
    const recorded = [];
    const { structuredGeminiConfig } = require('./schema');
    const { formatFactsBlock } = require('./facts');
    const config = structuredGeminiConfig(live.systemPrompt(speech.language), {
      locked: lock.lang,
      factsBlock: formatFactsBlock(table),
    });
    const { contentsWithCorrection } = require('./geminiTurn');
    const contents = ctx.history
      .filter((m) => String(m.content || '').trim())
      .slice(-16)
      .map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.content) }] }))
      .concat([{ role: 'user', parts: [{ text: caller }] }]);
    attempts = null;
    const result = await runStructuredTurn({
      locked: lock.lang,
      table,
      callerText,
      state: ctx.state,
      nameConfirmed: ctx.state?.caller?.nameConfirmed === true,
      correctionFor: (problems) => correctionTurn(lock.lang, problems),
      openStream: async ({ correction }) => {
        const stream = await live.generateContentStream({
          model: live.model,
          contents: contentsWithCorrection(contents, correction),
          config,
        });
        const row = { chunks: [], thoughtSignature: false };
        recorded.push(row);
        return (async function* tee() {
          for await (const chunk of stream) {
            const parts = chunk?.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.thoughtSignature) row.thoughtSignature = true;
              if (typeof part.text === 'string' && part.text && part.thought !== true) row.chunks.push(part.text);
            }
            yield chunk;
          }
        })();
      },
    });
    if (typeof live.record === 'function') live.record(turnIndex, { mock: false, attempts: recorded, lock });
    return finishStructured({ result, lock, speech, stages, pieces, source, trimmed, attemptsAvailable: recorded.length });
  }
  const result = await runStructuredTurn({
    locked: lock.lang,
    table,
    callerText,
    state: ctx.state,
    nameConfirmed: ctx.state?.caller?.nameConfirmed === true,
    correctionFor: (problems) => correctionTurn(lock.lang, problems),
    openStream: async ({ attempt }) => streamOf(attempts[Math.min(attempt, attempts.length) - 1]),
  });
  return finishStructured({ result, lock, speech, stages, pieces, source, trimmed, attemptsAvailable: attempts.length });
}

const LANGUAGE_CODES = new Set(['language', 'language_field']);

/**
 * A mock cannot answer a language regeneration: its text is the legacy reply
 * in the legacy language. Flag the turn (outcome needs_recording, not scored)
 * instead of scoring a repair line the real model would not have needed.
 */
function needsRecording(result, source) {
  if (source === 'live' || source === 'recorded') return false;
  // The mock's sentences are in whatever language the legacy model chose, so
  // language outcomes on a mock say nothing about the structured model.
  return result.problems.some((p) => LANGUAGE_CODES.has(p.code));
}

function finishStructured({ result, lock, speech, stages, pieces, source, trimmed, attemptsAvailable }) {
  result.spoken.forEach((row, i) => {
    const prepared = prepareStructuredPiece(row.text, {
      callLanguage: speech.language,
      language: lock.lang,
      first: pieces.length === 0,
    });
    if (!prepared.wire) {
      stages.push({ stage: 'transform', name: 'structured_boundary', reason: prepared.refused, before: row.text, after: '', dropped: true });
      return;
    }
    pieces.push({ text: prepared.text, wire: prepared.wire, before: row.text, language: prepared.language, source: row.source, index: i });
  });
  for (const t of result.transforms) {
    stages.push({
      stage: 'transform',
      name: t.name,
      reason: t.reason,
      before: t.before,
      after: t.after,
      dropped: Boolean(t.dropped),
    });
  }
  const structured = {
    stage: 'structured',
    lang: lock.lang,
    locked: lock.source,
    intent: result.intent,
    say: result.spoken.map((row) => row.text),
    factsUsed: result.factsUsed,
    problems: result.problems.map((p) => ({ attempt: p.attempt, code: p.code, detail: p.detail || null })),
    attempts: result.attempts,
    repaired: result.repaired,
    source,
    ...(trimmed.length ? { mockTrimmed: trimmed } : {}),
    ...(result.attempts > attemptsAvailable ? { replayedRegen: 'repeat_last_recorded_attempt' } : {}),
    ...(needsRecording(result, source) ? { needsRecording: true } : {}),
    tool: result.toolText || null,
  };
  return {
    spoken: pieces.map((p) => p.text).join(' '),
    before: result.spokenText,
    ttsLanguage: pieces[0]?.language || lock.lang,
    stages,
    canned: null,
    pieces,
    modelProse: result.modelSay.join(' '),
    raw: result.raw,
    structured,
    lock,
  };
}

module.exports = { speakStructured, sonioxTags };
