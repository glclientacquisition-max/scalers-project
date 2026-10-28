'use strict';
// BA v2 SHADOW hook (Voice side). Flag: BRAIN_V2_SHADOW (default off).
// Runs Brain's v2 runTurnStream next to the live turn, fire-and-forget:
//   - never awaited on the live path (caller hears today's v1 path only)
//   - never speaks (no TTS / media handles are reachable from here)
//   - never writes (dry-run handlers only; Brain's write tools are stubbed)
//   - logs one `brain_v2_shadow` stage into voice_turn_traces payload.stages
// Spec: /workspace/briefs/ba-v2-voice-scope.md §1.

const ON = /^(1|true|on|yes)$/i;
const DEFAULT_TIMEOUT_MS = 2500;
// Write tools Brain v2 can call vs the v1 trace names (server.js TRACE_TOOL_FIELDS).
const V2_TO_V1_TOOL = {
  createAppointment: 'create_appointment',
  createServiceRequest: 'create_service_request',
  updateAppointment: 'update_appointment',
  escalate: 'escalate',
  saveCallerInfo: 'save_caller_info',
};
const AGREEMENT_TOOLS = new Set(['create_appointment', 'create_service_request', 'update_appointment', 'escalate']);

// B2: server.js no longer runs the shadow (brainV2ShadowEnabled and its BRAIN_V2_SHADOW / BRAIN_V2_TENANTS reads are
// gone). diffAgainstLive stays only for voiceTrace's lazy require; B3 deletes this module with that hook.

function shadowTimeoutMs(env = process.env) {
  const n = Number(env.BRAIN_V2_SHADOW_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : DEFAULT_TIMEOUT_MS;
}

function words(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
}
// Token-set Jaccard similarity in [0,1]; 1 when both empty.
function textSimilarity(a, b) {
  const A = new Set(words(a)); const B = new Set(words(b));
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const w of A) if (B.has(w)) inter += 1;
  return Math.round((inter / (A.size + B.size - inter)) * 1000) / 1000;
}

// Diff the shadow stage against the committed live turn record (voiceTrace turn).
function diffAgainstLive(shadow, liveRecord) {
  const stages = Array.isArray(liveRecord?.stages) ? liveRecord.stages : [];
  const liveText = stages.filter((s) => s && s.stage === 'tts' && s.text).map((s) => s.text).join(' ').trim();
  const liveTools = [...new Set(stages.filter((s) => s && s.stage === 'tool' && s.name).map((s) => s.name))]
    .filter((n) => AGREEMENT_TOOLS.has(n)).sort();
  const v2Tools = [...new Set((shadow.toolIntents || []).map((t) => t.v1Name))]
    .filter((n) => AGREEMENT_TOOLS.has(n)).sort();
  const liveLang = liveRecord?.caller?.sticky || null;
  return {
    liveText,
    textSimilarity: textSimilarity(shadow.v2Text, liveText),
    textEqual: words(shadow.v2Text).join(' ') === words(liveText).join(' '),
    v1Tools: liveTools,
    v2Tools,
    toolIntentMatch: liveTools.join(',') === v2Tools.join(','),
    langMismatch: !!(shadow.v2Lang && (liveLang === 'en' || liveLang === 'sw') && shadow.v2Lang !== liveLang),
  };
}

// Caller file for v2 createState: phone, file name, open visits as raw
// appointment rows (v2 normRow reads id/service_name/window_start/address_landmark/status).
function callerFileForState(opts = {}) {
  let file = opts.callerFile;
  if (typeof file === 'function') { try { file = file(); } catch { file = null; } }
  file = file || {};
  const openRows = (Array.isArray(file.openRows) ? file.openRows : [])
    .filter((r) => r && (r.kind ? r.kind === 'visit' : true) && !r.past)
    .map((r) => ({
      id: r.id || null,
      service_name: r.service_name || r.job || null,
      window_start: r.window_start || r.windowStart || null,
      address_landmark: r.address_landmark || r.place || null,
      status: r.status || 'requested',
    }));
  return {
    callerPhone: file.callerPhone || opts.callerPhone || null,
    contactName: file.contactName || null,
    openRows,
  };
}

function loadV2() {
  return require('./v2'); // lazy: flag-off never loads Brain v2
}

// Per-call shadow runner. Keeps its own v2 state machine (never touches v1 brainState).
function createBrainV2Shadow(opts = {}) {
  const env = opts.env || process.env;
  const log = opts.log || ((msg) => console.warn(msg));
  const label = opts.callLabel || (() => 'call');
  const now = opts.now || (() => Date.now());
  const loader = opts.loadV2 || loadV2;
  let v2 = null;
  let state = null;
  let model; // undefined = not resolved yet
  let chain = Promise.resolve(); // 1 in flight per call; turns run in order
  let inFlight = 0;
  let disabled = false;
  let lastConsume = null; // the running turn's own stream; a timed-out turn keeps it alive

  function resolveModel() {
    if (model !== undefined) return model;
    model = null; // zero-cost shadow by default (NLU + state machine only)
    const name = String(env.BRAIN_V2_SHADOW_MODEL || '').trim();
    if (name && !/^(off|0|false|none|null)$/i.test(name)) {
      try {
        model = v2.createGeminiModel({
          apiKey: env.GEMINI_API_KEY, // passed through, never logged
          model: ON.test(name) ? undefined : name,
          timeoutMs: shadowTimeoutMs(env),
          onError: (e) => log(`[brain_v2_shadow][${label()}] model error: ${e?.code || e?.status || e?.message}`),
        });
      } catch (err) {
        log(`[brain_v2_shadow][${label()}] model init failed: ${err?.message || err}`);
        model = null;
      }
    }
    return model;
  }

  async function runOne({ text, profile, langLock, turnIndex, acked: ackedIn, ackRule, stripAck, ackWaitMs }) {
    // VOICE_ACK_RULE: acked = a word filler actually played on the live turn.
    // Live decides that after fillerDelayMs, so wait for it, then read.
    let acked = ackedIn;
    if (ackRule && typeof ackedIn === 'function') {
      const waitMs = Math.max(0, Math.min(Number(ackWaitMs) || 0, 1500));
      if (waitMs) await new Promise((r) => setTimeout(r, waitMs));
      try { acked = !!ackedIn(); } catch { acked = false; }
    }
    const started = now();
    const dry = v2.createDryRunHandlers({ log: [] });
    const handlers = {};
    for (const [k, fn] of Object.entries(dry)) if (typeof fn === 'function') handlers[k] = fn;
    const toolIntents = []; const sentences = [];
    let firstAt = null; let done = null; let timedOut = false; let abortFlag = false;
    const timeoutMs = shadowTimeoutMs(env);
    const consume = (async () => {
      const it = v2.runTurnStream(state, {
        text, profile: { ...(profile || {}) }, now: new Date(), handlers, model: resolveModel(),
        langLock: langLock === 'en' || langLock === 'sw' ? langLock : null,
        shouldAbort: () => abortFlag,
        ...(ackRule ? { acked: !!acked } : {}),
      });
      for await (const ev of it) {
        if (abortFlag) break;
        if (!ev) continue;
        if (ev.type === 'tool' && ev.phase === 'start') {
          if (firstAt == null) firstAt = now();
          toolIntents.push({ name: ev.name, v1Name: V2_TO_V1_TOOL[ev.name] || ev.name, args: ev.args ?? null, write: !!ev.write, dryRun: true });
        } else if (ev.type === 'sentence') {
          if (firstAt == null) firstAt = now();
          // VOICE_ACK_RULE backstop on v2 lines: Voice owns the tool-turn ack, so strip any lead.
          const heard = ackRule && acked ? (typeof stripAck === 'function' ? stripAck(ev.text) : ev.text) : ev.text;
          sentences.push({ text: heard, lang: ev.lang, source: ev.source, ...(heard !== ev.text ? { rawText: ev.text } : {}) });
        } else if (ev.type === 'done') {
          done = ev;
        }
      }
    })();
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => { timedOut = true; abortFlag = true; resolve(); }, timeoutMs); });
    let error = null;
    try { await Promise.race([consume, timeout]); } catch (err) { error = err?.message || String(err); }
    finally { clearTimeout(timer); }
    consume.catch(() => {}); // a late rejection after timeout is swallowed
    lastConsume = consume; // the chain waits on this, not on the timeout race
    const total = now() - started;
    const v2Text = sentences.map((s) => s.text).join(' ').trim() || (done?.line || '');
    return {
      stage: 'brain_v2_shadow',
      mode: 'shadow',
      turnIndex,
      v2Text, // logged only, NEVER spoken (dry-run "Done, booked" lines included)
      v2Lang: sentences[0]?.lang || state?.lang || null,
      langLock: langLock || null,
      sentences,
      toolIntents,
      writeIntents: toolIntents.filter((t) => t.write).length,
      ...(ackRule ? { acked: !!acked, voiceAck: acked && toolIntents.length ? 'tool_start' : null } : {}),
      model: model ? String(env.BRAIN_V2_SHADOW_MODEL) : null,
      ttftMs: firstAt == null ? null : firstAt - started,
      totalMs: total,
      timedOut,
      aborted: timedOut || !!done?.aborted,
      end: !!done?.end,
      error,
    };
  }

  // Fire-and-forget entry point. Returns a promise for tests only; callers must `void` it.
  function fire({ text, profile, langLock, turnIndex, onResult, acked, ackRule, stripAck, ackWaitMs }) {
    if (disabled) return Promise.resolve(null);
    if (inFlight >= 6) { // turns run in order (v2 state needs every turn); runaway backlog is dropped
      return Promise.resolve(null);
    }
    inFlight += 1;
    let resolveStage;
    const p = new Promise((r) => { resolveStage = r; });
    const step = chain.then(async () => {
      // Yield past the live turn's synchronous work (Gemini request kick-off) first.
      await new Promise((resolve) => setImmediate(resolve));
      try {
        if (!v2) {
          v2 = loader();
          state = v2.createState({ profile: profile || {}, ...callerFileForState(opts) });
        }
        lastConsume = null;
        const stage = await runOne({ text, profile, langLock, turnIndex, acked, ackRule, stripAck, ackWaitMs });
        if (typeof onResult === 'function') {
          try { onResult(stage); } catch (err) { log(`[brain_v2_shadow][${label()}] trace failed: ${err?.message || err}`); }
        }
        resolveStage(stage);
      } catch (err) {
        if (!v2) disabled = true; // v2 not loadable: stop trying for this call
        log(`[brain_v2_shadow][${label()}] failed: ${err?.message || err}`);
        resolveStage(null);
      }
      // Never two turns on one state: the next turn starts only after this turn's
      // own stream has finished, even when the trace was cut at the timeout.
      if (lastConsume) {
        const stallMs = Math.max(10000, shadowTimeoutMs(env) * 4);
        let timer;
        const stalled = await Promise.race([
          lastConsume.then(() => false, () => false),
          new Promise((r) => { timer = setTimeout(() => r(true), stallMs); if (timer.unref) timer.unref(); }),
        ]);
        clearTimeout(timer);
        if (stalled) {
          disabled = true; // state is still owned by a hung turn: stop shadowing this call
          log(`[brain_v2_shadow][${label()}] turn stalled > ${stallMs}ms; shadow off for this call`);
        }
      }
      inFlight -= 1;
    });
    chain = step.catch(() => null);
    return p;
  }

  return { fire, get inFlight() { return inFlight; } };
}

module.exports = {
  callerFileForState,
  createBrainV2Shadow,
  diffAgainstLive,
  textSimilarity,
  shadowTimeoutMs,
  V2_TO_V1_TOOL,
};
