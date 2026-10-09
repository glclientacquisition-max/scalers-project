// One structured Gemini voice turn, independent of the socket.
//
// Gemini streams one JSON object (schema.js). Each say[] sentence is checked
// (verify.js) the moment its string closes and, if it passes, handed to
// onSay for TTS. A failure before anything was spoken gets exactly one
// corrective regeneration. A failure after that, or on the retry, is
// answered from data (a grounded price or coverage line) or with the
// language pack's honest line, and is traced. If nothing at all can be
// spoken, the pack's repair line is spoken. Nothing is dropped silently:
// every intervention is a transform with a reason.
//
// The old filter chain (polishSpokenDetail, guardSpokenReply, cutNoAiSlop,
// softenCataloguePunctuation, stream-join heuristics) is not called here.

const { extractGeminiText, extractThoughtSignature } = require('../../conversation/geminiVoice');
const { createStructuredStreamReader, parseStructured } = require('./jsonStream');
const { verifySay, dataLineFor } = require('./verify');
const { getLanguagePack } = require('./languages');
const { MAX_SAY, TOOL_NAMES } = require('./schema');

const QUESTION_END = /[?？]["'”’)]*\s*$/;
/** Raw model parts as streamed (no spoken-text sanitising: this is JSON). */
function appendRawParts(acc, chunk) {
  const next = acc.slice();
  const parts = chunk?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return next;
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const prev = next[next.length - 1];
    const plain = (p) => p && p.thought !== true && !p.thoughtSignature && typeof p.text === 'string';
    if (plain(prev) && plain(part)) prev.text += part.text;
    else if (typeof part.text === 'string' && !part.text && !part.thoughtSignature) continue;
    else next.push({ ...part });
  }
  return next;
}

function wordCount(text) {
  return String(text || '').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function isQuestion(text) {
  return QUESTION_END.test(String(text || '').trim());
}

function toolTextFrom(value, problems) {
  if (!value || typeof value !== 'object') return '';
  let text = '';
  const tool = value.tool;
  if (tool && typeof tool === 'object' && tool.name) {
    if (!TOOL_NAMES.includes(tool.name)) {
      problems.push({ code: 'tool_name', detail: String(tool.name) });
    } else {
      try {
        const args = tool.args_json ? JSON.parse(String(tool.args_json)) : {};
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('not an object');
        text += `###TOOL###${JSON.stringify({ [tool.name]: args })}###ENDTOOL###`;
      } catch (err) {
        problems.push({ code: 'tool_json', detail: String(err?.message || err) });
      }
    }
  }
  if (value.end_call === true) text += `${text ? ' ' : ''}###ENDCALL###`;
  return text;
}

/**
 * @param {{
 *   openStream: (o: { attempt: number, correction: object|null }) => Promise<AsyncIterable<any>>,
 *   locked: 'en'|'sw'|'sheng',
 *   table: object,
 *   callerText?: string,
 *   state?: object|null,
 *   nameConfirmed?: boolean,
 *   onSay?: (text: string, meta: { source: string, index: number }) => Promise<void>|void,
 *   holdSpeech?: boolean,
 *   shouldAbort?: () => boolean,
 *   maxAttempts?: number,
 *   correctionFor?: (problems: object[]) => object,
 *   log?: (line: string) => void,
 *   now?: () => number,
 * }} opts
 */
async function runStructuredTurn(opts) {
  const {
    openStream,
    locked,
    table,
    callerText = '',
    state = null,
    nameConfirmed = false,
    onSay = null,
    holdSpeech = false,
    shouldAbort = () => false,
    maxAttempts = 2,
    correctionFor = () => null,
    log = () => {},
    now = Date.now,
  } = opts;
  const pack = getLanguagePack(locked);
  const spoken = [];
  const problems = [];
  const transforms = [];
  let firstTokenAt = null;
  let firstSayAt = null;
  let unverifiedSpoken = false;
  let aborted = false;
  let providerError = null;
  let final = { value: null, raw: '', modelParts: [], thoughtSignature: '', attempt: 0, modelSay: [] };

  async function speak(text, source, index) {
    const line = String(text || '').trim();
    if (!line) return;
    if (spoken.some((row) => row.text === line)) {
      transforms.push({ name: 'structured_verify', reason: 'duplicate_line', before: line, after: '', dropped: true });
      return;
    }
    if (firstSayAt == null) firstSayAt = now();
    spoken.push({ text: line, source, index });
    if (!holdSpeech && typeof onSay === 'function') await onSay(line, { source, index });
  }

  let attempt = 0;
  let correction = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    const reader = createStructuredStreamReader();
    let modelParts = [];
    let thoughtSignature = '';
    let pendingQuestion = null;
    let spokenQuestion = false;
    let heldShort = null;
    let deferred = [];
    let retry = false;
    let langChecked = false;
    const modelSay = [];
    let sayIndex = 0;

    const verifyCtx = (factsUsed) => ({
      locked,
      table,
      factsUsed,
      callerText,
      state,
      nameConfirmed,
    });

    // Returns false when the attempt should stop for a regeneration.
    async function handleItem(text, factsUsed) {
      const index = sayIndex;
      sayIndex += 1;
      if (typeof text !== 'string') {
        problems.push({ attempt, code: 'schema_say_item', detail: 'say item is not a string' });
        return !(spoken.length === 0 && attempt < maxAttempts);
      }
      modelSay.push(text);
      if (index >= MAX_SAY) {
        problems.push({ attempt, code: 'over_max_say', detail: `say item ${index + 1}`, sentence: text });
        transforms.push({ name: 'structured_verify', reason: 'over_max_say', before: text, after: '', dropped: true });
        return true;
      }
      const checked = verifySay(text, verifyCtx(factsUsed));
      let line = text;
      if (checked.fixed) {
        // VOICE_SPOKEN_FACTS: the stored visit time, in the Kiswahili clock.
        transforms.push({ name: 'spoken_facts', reason: 'clock', before: text, after: checked.fixed, dropped: false });
        line = checked.fixed;
      }
      if (!checked.ok) {
        for (const p of checked.problems) problems.push({ attempt, ...p, sentence: text });
        if (spoken.length === 0 && attempt < maxAttempts) return false;
        const codes = checked.problems.map((p) => p.code);
        const data = dataLineFor(text, checked.problems, { table, pack, callerText });
        const factual = codes.some((c) => c === 'unbacked_number' || c === 'time_mismatch' || c.startsWith('coverage_'));
        if (data) line = data;
        else if (factual && !unverifiedSpoken) {
          line = pack.unverified;
          unverifiedSpoken = true;
        } else line = '';
        transforms.push({
          name: 'structured_verify',
          reason: codes.join(','),
          before: text,
          after: line,
          dropped: !line,
        });
        if (!line) return true;
      }
      if (isQuestion(line)) {
        // One question per reply: the first one asked. A later question is
        // usually a generic tail ("How else can I help?").
        if (pendingQuestion || spokenQuestion) {
          transforms.push({
            name: 'structured_order',
            reason: 'stacked_question',
            before: line,
            after: '',
            dropped: true,
          });
          return true;
        }
        pendingQuestion = { line, index };
        return true;
      }
      if (pendingQuestion) {
        transforms.push({
          name: 'structured_order',
          reason: 'question_last',
          before: pendingQuestion.line,
          after: pendingQuestion.line,
          dropped: false,
          moved: true,
        });
      }
      // A short opener ("Okay.", "Pole sana.") cannot show its language or
      // facts. Hold it until the next sentence passes, so a failure there can
      // still regenerate with nothing spoken.
      if (spoken.length === 0 && !heldShort && line === text && wordCount(line) <= 3) {
        heldShort = { line, index };
        return true;
      }
      await flushHeldShort();
      await speak(line, line === text ? 'model' : 'data', index);
      return true;
    }

    async function flushHeldShort() {
      if (!heldShort) return;
      const held = heldShort;
      heldShort = null;
      await speak(held.line, 'model', held.index);
    }

    try {
      const stream = await openStream({ attempt, correction });
      for await (const chunk of stream) {
        if (shouldAbort()) {
          aborted = true;
          break;
        }
        modelParts = appendRawParts(modelParts, chunk);
        thoughtSignature = extractThoughtSignature(chunk) || thoughtSignature;
        const delta = extractGeminiText(chunk);
        if (!delta) continue;
        if (firstTokenAt == null) firstTokenAt = now();
        const scan = reader.push(delta);
        if (!langChecked && typeof scan.fields.lang === 'string') {
          langChecked = true;
          if (scan.fields.lang !== pack.code) {
            problems.push({ attempt, code: 'language_field', detail: `lang ${scan.fields.lang}, locked ${pack.code}` });
            if (spoken.length === 0 && attempt < maxAttempts) {
              retry = true;
              break;
            }
          }
        }
        if (scan.fresh.length) deferred = deferred.concat(scan.fresh);
        // Hold sentences until facts_used is known (schema order puts it first).
        if (!scan.sawFactsUsed && !scan.complete) continue;
        const factsUsed = Array.isArray(scan.fields.facts_used) ? scan.fields.facts_used : [];
        while (deferred.length) {
          const item = deferred.shift();
          if (!(await handleItem(item, factsUsed))) {
            retry = true;
            break;
          }
          if (shouldAbort()) {
            aborted = true;
            break;
          }
        }
        if (retry || aborted) break;
        if (scan.sayClosed) await flushHeldShort();
        if (scan.sayClosed && pendingQuestion) {
          await speak(pendingQuestion.line, 'model', pendingQuestion.index);
          pendingQuestion = null;
          spokenQuestion = true;
        }
      }
    } catch (err) {
      if (spoken.length === 0) {
        providerError = err;
        final = { value: null, raw: reader.raw(), modelParts, thoughtSignature, attempt, modelSay };
        break;
      }
      log(`structured stream failed after speech: ${err?.message || err}`);
      problems.push({ attempt, code: 'stream_error', detail: String(err?.message || err) });
    }

    const raw = reader.raw();
    const parsed = parseStructured(raw);
    if (!retry && !aborted) {
      // Stream ended: sentences still waiting (facts_used never came) are checked now.
      const factsUsed = parsed.ok && Array.isArray(parsed.value.facts_used) ? parsed.value.facts_used : [];
      if (deferred.length && !reader.state().sawFactsUsed) {
        problems.push({ attempt, code: 'schema_order', detail: 'facts_used did not precede say' });
      }
      while (deferred.length && !retry && !aborted) {
        if (!(await handleItem(deferred.shift(), factsUsed))) retry = true;
      }
      if (!retry && !aborted) await flushHeldShort();
      if (!retry && pendingQuestion && !aborted) {
        await speak(pendingQuestion.line, 'model', pendingQuestion.index);
        pendingQuestion = null;
        spokenQuestion = true;
      }
      if (!retry && !parsed.ok) {
        problems.push({ attempt, code: `schema_${parsed.error}`, detail: 'reply was not one complete JSON object' });
        if (spoken.length === 0 && attempt < maxAttempts) retry = true;
      } else if (!retry && parsed.ok && (!Array.isArray(parsed.value.say) || !parsed.value.say.length)) {
        problems.push({ attempt, code: 'schema_no_say', detail: 'say is empty' });
        if (spoken.length === 0 && attempt < maxAttempts) retry = true;
      }
    }
    final = { value: parsed.ok ? parsed.value : null, raw, modelParts, thoughtSignature, attempt, modelSay };
    if (providerError || aborted) break;
    if (retry && spoken.length === 0 && attempt < maxAttempts) {
      const recent = problems.filter((p) => p.attempt === attempt);
      log(`structured regen lang=${locked} because=${recent.map((p) => p.code).join(',')}`);
      correction = correctionFor(recent);
      continue;
    }
    break;
  }

  let repaired = false;
  if (!spoken.length && !aborted && !providerError) {
    transforms.push({
      name: 'structured_repair',
      reason: problems.length ? problems.map((p) => p.code).join(',') : 'empty',
      before: final.modelSay.join(' '),
      after: pack.repair,
      dropped: false,
    });
    await speak(pack.repair, 'repair', 0);
    repaired = true;
  }

  const toolProblems = [];
  const toolText = providerError ? '' : toolTextFrom(final.value, toolProblems);
  for (const p of toolProblems) problems.push({ attempt: final.attempt, ...p });

  return {
    spoken,
    spokenText: spoken.map((row) => row.text).join(' '),
    value: final.value,
    raw: final.raw,
    modelSay: final.modelSay,
    modelParts: final.modelParts,
    thoughtSignature: final.thoughtSignature,
    attempts: attempt,
    regenerated: attempt > 1,
    problems,
    transforms,
    firstTokenAt,
    firstSayAt,
    repaired,
    aborted,
    providerError,
    toolText,
    intent: final.value?.intent || null,
    factsUsed: Array.isArray(final.value?.facts_used) ? final.value.facts_used : [],
    lang: pack.code,
  };
}

/**
 * Gemini history for this turn: what was actually spoken, in the same JSON
 * shape the model writes, so its next turn cannot contradict the caller's
 * audio. The signed parts are kept as received when the model's own say[]
 * was spoken verbatim.
 */
function historyPartsFor(result, opts = {}) {
  const lines = Array.isArray(opts.spokenLines) ? opts.spokenLines : result.spoken.map((row) => row.text);
  const sayVerbatim =
    lines.length === result.spoken.length &&
    lines.every((line, i) => line === result.spoken[i].text) &&
    result.attempts === 1 &&
    !result.repaired &&
    result.spoken.length === result.modelSay.length &&
    result.spoken.every((row, i) => row.text === String(result.modelSay[i] || '').trim());
  const value = {
    lang: result.lang,
    intent: result.intent || 'other',
    facts_used: result.factsUsed || [],
    say: lines,
    ...(result.value?.tool ? { tool: result.value.tool } : {}),
    ...(result.value?.end_call === true ? { end_call: true } : {}),
  };
  const text = JSON.stringify(value);
  const parts = Array.isArray(result.modelParts) ? result.modelParts : [];
  if (sayVerbatim && parts.some((p) => typeof p.text === 'string' && p.text)) {
    return { parts: parts.map((p) => ({ ...p })), text, rewritten: false };
  }
  const signature = result.thoughtSignature || parts.find((p) => p.thoughtSignature)?.thoughtSignature || '';
  const out = parts.filter((p) => p.thought === true).map((p) => ({ ...p }));
  out.push({ text, ...(signature ? { thoughtSignature: signature } : {}) });
  return { parts: out, text, rewritten: true };
}

module.exports = { runStructuredTurn, historyPartsFor, isQuestion };
