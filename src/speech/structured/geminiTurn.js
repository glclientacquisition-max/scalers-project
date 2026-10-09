// Provider loop around runStructuredTurn: the Gemini call, its per-call
// deadline, and the same retry/backup rule as the legacy stream
// (nextGeminiStreamAttempt). The server owns tools and history; tests and
// replay pass a recorded or mocked generateContentStream.

const {
  withTimeout,
  isTimeoutError,
  isHardGeminiOutage,
  nextGeminiStreamAttempt,
} = require('../../conversation/geminiVoice');
const { runStructuredTurn } = require('./turn');
const { structuredGeminiConfig, correctionTurn } = require('./schema');

/** Wrap an async iterable so each step must arrive before the call's deadline. */
function withDeadline(iterable, deadlineAt, label) {
  return {
    [Symbol.asyncIterator]() {
      const it = iterable[Symbol.asyncIterator]();
      return {
        next() {
          const left = deadlineAt - Date.now();
          if (left <= 0) return Promise.reject(new Error(`${label} timed out after 0ms`));
          return withTimeout(it.next(), left, label);
        },
        return(value) {
          return typeof it.return === 'function' ? it.return(value) : Promise.resolve({ done: true, value });
        },
      };
    },
  };
}

/** The caller's last turn carries the one correction (no extra model turn without a signature). */
function contentsWithCorrection(contents, correction) {
  const out = (Array.isArray(contents) ? contents : []).map((c) => ({ ...c, parts: [...(c.parts || [])] }));
  if (!correction) return out;
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.parts.push(...correction.parts);
  else out.push(correction);
  return out;
}

/**
 * @param {{
 *   generateContentStream: (req: { model: string, contents: object[], config: object }) => Promise<AsyncIterable<any>>,
 *   contents: object[],
 *   systemPrompt: string,
 *   factsBlock: string,
 *   lock: { lang: 'en'|'sw'|'sheng', source?: string },
 *   table: object,
 *   callerText?: string,
 *   state?: object|null,
 *   nameConfirmed?: boolean,
 *   onSay?: (text: string, meta: object) => Promise<void>|void,
 *   shouldAbort?: () => boolean,
 *   primary: string,
 *   backup: string,
 *   timeoutMs?: number,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<void>,
 *   env?: object,
 * }} opts
 */
async function runStructuredGeminiTurn(opts) {
  const {
    generateContentStream,
    contents,
    systemPrompt,
    factsBlock,
    lock,
    primary,
    backup,
    timeoutMs = 0,
    log = () => {},
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    env = process.env,
  } = opts;
  const config = structuredGeminiConfig(systemPrompt, { locked: lock.lang, factsBlock, env });
  let model = primary;
  let providerAttempt = 0;
  let calls = 0;
  let last = null;
  while (providerAttempt < 3) {
    const result = await runStructuredTurn({
      ...opts,
      locked: lock.lang,
      correctionFor: (problems) => correctionTurn(lock.lang, problems),
      log,
      openStream: async ({ attempt, correction }) => {
        calls += 1;
        log(`structured gemini model=${model} call=${calls} attempt=${attempt} lang=${lock.lang}`);
        const deadlineAt = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;
        const request = generateContentStream({
          model,
          contents: contentsWithCorrection(contents, correction),
          config,
        });
        const stream = timeoutMs > 0 ? await withTimeout(request, timeoutMs, 'Gemini stream') : await request;
        return deadlineAt === Infinity ? stream : withDeadline(stream, deadlineAt, 'Gemini stream');
      },
    });
    last = result;
    if (!result.providerError) break;
    const next = nextGeminiStreamAttempt({
      err: result.providerError,
      attempt: providerAttempt,
      spoke: result.spoken.length > 0,
      primary,
      backup,
    });
    if (next.action === 'stop') break;
    log(`structured gemini ${next.action} model=${next.model} after: ${result.providerError?.message || result.providerError}`);
    if (next.waitMs) await sleep(next.waitMs);
    model = next.model;
    providerAttempt += 1;
  }
  const err = last.providerError;
  return {
    ...last,
    model,
    calls,
    llmFailed: Boolean(err),
    llmHardDown: Boolean(err && isHardGeminiOutage(err)),
    timedOut: Boolean(err && isTimeoutError(err)),
    config,
  };
}

module.exports = { runStructuredGeminiTurn, contentsWithCorrection, withDeadline };
