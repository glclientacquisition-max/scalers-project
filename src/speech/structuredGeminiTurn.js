// Live Gemini turn in JSON mode. Sentences stream to TTS as each
// spoken_sentences item closes. One regeneration if the language or
// schema is wrong. A hard provider outage stays on the existing
// downtime path. Any other failure still returns a repair line.

const {
  extractGeminiText,
  extractThoughtSignature,
  appendGeminiStreamParts,
  modelPartsForHistory,
  withTimeout,
  isTimeoutError,
  isHardGeminiOutage,
  nextGeminiStreamAttempt,
  geminiPrimaryModel,
  geminiBackupModel,
  spokenTextForToolTurn,
} = require('../conversation/geminiVoice');
const { parseGeminiResponse } = require('../conversation/toolMarkers');
const { formatToolConfirmation } = require('../conversation/toolExecution');
const { createSpokenSentenceParser } = require('./jsonSentenceStream');
const { getLanguagePack } = require('./languages');
const {
  structuredGeminiConfig,
  correctiveInstruction,
  parseStructuredJson,
  validateStructuredReply,
  bestFallbackSentences,
  reconstructModelText,
  repairLine,
  finishSentence,
} = require('./structuredReply');
const { createNameGate } = require('./turnMachine');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStructuredStream(stream, { lockedLanguage, onSentence, shouldAbort, extractText }) {
  const parser = createSpokenSentenceParser();
  const read = extractText || extractGeminiText;
  let modelParts = [];
  let thoughtSignature = '';
  let firstTokenAt = null;
  let language = null;
  let mismatch = false;
  let emitted = 0;
  const held = [];
  const started = Date.now();
  let firstSentenceAt = null;

  for await (const chunk of stream) {
    if (shouldAbort?.()) break;
    modelParts = appendGeminiStreamParts(modelParts, chunk);
    thoughtSignature = extractThoughtSignature(chunk) || thoughtSignature;
    const delta = read(chunk);
    if (!delta) continue;
    if (!firstTokenAt) firstTokenAt = Date.now();
    const tick = parser.push(delta);
    if (tick.language) language = tick.language;
    if (language && language !== lockedLanguage) mismatch = true;
    if (mismatch) continue;
    if (!language) {
      held.push(...tick.sentences);
      continue;
    }
    const ready = held.splice(0, held.length).concat(tick.sentences);
    for (const sentence of ready) {
      if (shouldAbort?.()) break;
      const line = finishSentence(sentence);
      if (!line) continue;
      if (!firstSentenceAt) firstSentenceAt = Date.now();
      emitted += 1;
      if (typeof onSentence === 'function') await onSentence(line);
    }
  }

  return {
    raw: parser.raw(),
    language,
    mismatch,
    emitted,
    held,
    modelParts,
    thoughtSignature,
    firstTokenAt,
    firstSentenceMs: firstSentenceAt ? firstSentenceAt - started : null,
  };
}

async function openOnce({ startStream, model, config, timeoutMs }) {
  const stream = await startStream(model, config);
  return stream;
}

/**
 * @param {object} args
 * @param {Array} args.messages
 * @param {string} args.systemPrompt
 * @param {string} args.lockedLanguage
 * @param {(sentence: string) => Promise<void>} [args.onSentence]
 * @param {() => boolean} [args.shouldAbort]
 * @param {(model: string, config: object) => Promise<AsyncIterable<unknown>>} args.startStream
 * @param {(parsed: object) => Promise<{ results: object[], shouldEndCall: boolean }>} args.applyTools
 */
async function runStructuredGeminiTurn({
  messages,
  systemPrompt,
  lockedLanguage,
  onSentence,
  shouldAbort,
  startStream,
  applyTools,
  callSid = 'voice',
  timeoutMs = 8000,
  callerState = null,
} = {}) {
  const locked = getLanguagePack(lockedLanguage).code;
  const gate = createNameGate(callerState, locked);
  async function emitSentence(sentence) {
    const line = gate.consider(sentence);
    if (!line || typeof onSentence !== 'function') return;
    await onSentence(line);
  }
  const primary = geminiPrimaryModel();
  const backup = geminiBackupModel();
  let model = primary;
  let attempt = 0;
  let streamErr = null;
  let read = null;

  while (attempt < 3) {
    streamErr = null;
    try {
      const config = structuredGeminiConfig(systemPrompt, locked);
      console.log(
        `[${callSid}] Gemini structured stream model=${model} attempt=${attempt + 1} lang=${locked}`
      );
      read = await withTimeout(
        (async () => {
          const stream = await openOnce({ startStream, model, config, timeoutMs });
          return readStructuredStream(stream, { lockedLanguage: locked, onSentence: emitSentence, shouldAbort });
        })(),
        timeoutMs,
        'Gemini structured stream'
      );
      break;
    } catch (err) {
      streamErr = err;
      const next = nextGeminiStreamAttempt({
        err,
        attempt,
        spoke: false,
        primary,
        backup,
      });
      if (next.action === 'stop') break;
      if (next.waitMs) await sleep(next.waitMs);
      model = next.model;
      attempt += 1;
      read = null;
    }
  }

  if (!read && streamErr && isHardGeminiOutage(streamErr)) {
    return {
      spokenText: '',
      rawText: '',
      firstTokenAt: null,
      spokenEmitted: 0,
      model,
      actionConfirmation: '',
      toolResults: [],
      shouldEndCall: false,
      streamed: false,
      llmFailed: true,
      llmHardDown: true,
      timedOut: false,
      structured: true,
    };
  }

  let regenerated = false;
  let parsed = parseStructuredJson(read?.raw || '');
  let checked = parsed.ok ? validateStructuredReply(parsed.value, locked) : { ok: false, problems: ['parse'], sentences: [] };
  const needRegen = !read || read.mismatch || !checked.ok;
  if (needRegen && !shouldAbort?.() && !(streamErr && isHardGeminiOutage(streamErr)) && !(read && read.emitted)) {
    regenerated = true;
    const problems = read?.mismatch ? ['language_mismatch'] : checked.problems;
    const corrective = [systemPrompt, correctiveInstruction(locked, problems)].join('\n\n');
    try {
      const config = structuredGeminiConfig(corrective, locked);
      console.log(`[${callSid}] Gemini structured regen lang=${locked} because=${problems.join(',')}`);
      const second = await withTimeout(
        (async () => {
          const stream = await startStream(model, config);
          return readStructuredStream(stream, { lockedLanguage: locked, onSentence: emitSentence, shouldAbort });
        })(),
        timeoutMs,
        'Gemini structured regen'
      );
      if (second) {
        read = second;
        parsed = parseStructuredJson(second.raw || '');
        checked = parsed.ok
          ? validateStructuredReply(parsed.value, locked)
          : { ok: false, problems: ['parse'], sentences: second.held || [] };
        if (!second.emitted && checked.sentences.length) {
          for (const sentence of checked.sentences) {
            if (shouldAbort?.()) break;
            await emitSentence(sentence);
          }
        }
      }
    } catch (err) {
      streamErr = err;
      console.warn(`[${callSid}] structured regen failed:`, err?.message || err);
    }
  }

  const value = parsed.ok ? parsed.value : {};
  let sentences = checked.sentences?.length
    ? checked.sentences
    : bestFallbackSentences(read?.held || [], locked);
  if (!read?.emitted && sentences.length && !regenerated) {
    for (const sentence of sentences) {
      if (shouldAbort?.()) break;
      await emitSentence(sentence);
    }
  }
  if (!sentences.length) sentences = [repairLine(locked)];
  gate.finish();
  const gatedText = gate.spoken.join(' ').trim();
  const spokenBody = gatedText || sentences.join(' ');
  const reconstructed = parsed.ok ? reconstructModelText({ ...value, spoken_sentences: sentences }) : spokenBody;
  const toolParsed = parseGeminiResponse(reconstructed);
  let execution = { results: [], shouldEndCall: false };
  if (typeof applyTools === 'function') {
    try {
      execution = await applyTools(toolParsed);
    } catch (err) {
      console.warn(`[${callSid}] structured tools failed:`, err?.message || err);
    }
  }
  const actionConfirmation = formatToolConfirmation(execution.results, locked);
  const spokenText =
    spokenTextForToolTurn({
      spoken: spokenBody,
      toolResults: execution.results,
    }) || (read?.emitted ? spokenBody : repairLine(locked));

  if (Array.isArray(messages)) {
    messages.push({
      role: 'assistant',
      content: [spokenText, actionConfirmation].filter(Boolean).join(' '),
      geminiParts: modelPartsForHistory({
        geminiParts: read?.modelParts || [],
        text: read?.raw || reconstructed,
        thoughtSignature: read?.thoughtSignature || '',
      }),
      thoughtSignature: read?.thoughtSignature || undefined,
    });
  }

  const hardDown = Boolean(streamErr && isHardGeminiOutage(streamErr) && !read?.emitted);
  const spokenOut = hardDown ? '' : spokenText || repairLine(locked);
  return {
    spokenText: spokenOut,
    rawText: read?.raw || reconstructed,
    firstTokenAt: read?.firstTokenAt || null,
    spokenEmitted: read?.emitted || (hardDown ? 0 : sentences.length),
    firstSentenceMs: read?.firstSentenceMs ?? null,
    model,
    actionConfirmation,
    toolResults: execution.results || [],
    shouldEndCall: Boolean(execution.shouldEndCall),
    streamed: Boolean(read && !streamErr),
    llmFailed: hardDown,
    llmHardDown: hardDown,
    timedOut: Boolean(streamErr && isTimeoutError(streamErr) && hardDown),
    regenerated,
    structured: true,
    replyLanguage: locked,
    nameStages: gate.stages,
  };
}

module.exports = {
  readStructuredStream,
  runStructuredGeminiTurn,
};
