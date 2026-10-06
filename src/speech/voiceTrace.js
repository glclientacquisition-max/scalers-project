// Per-turn voice trace. Stages are an ordered list so a later model
// (Gemini Live, a tool state machine) adds a stage. It does not need a new table.
// Speech text stays because scoring needs it. Phones and emails are redacted.
// Names stay, and every record is flagged pii=transcript. Service role only.

const fs = require('fs');
const path = require('path');

const SCHEMA = 'scalers.voice.turn';
const CALL_SCHEMA = 'scalers.voice.call';
const SCHEMA_VERSION = 1;
const TEXT_CAP = 4000;
const TOKEN_CAP = 80;
const STT_BUFFER_CAP = 40;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b/g;

function voiceTraceEnabled(env = process.env) {
  const flag = String(env.VOICE_TRACE ?? 'auto').trim().toLowerCase();
  if (flag === 'on' || flag === '1' || flag === 'true' || flag === 'yes') return true;
  if (flag === 'off' || flag === '0' || flag === 'false' || flag === 'no') return false;
  const name = String(
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || ''
  ).toLowerCase();
  if (name.includes('prod')) return false;
  if (name.includes('stag') || name.includes('preview')) return true;
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return false;
  return true;
}

function clip(text, max = TEXT_CAP) {
  const raw = String(text ?? '');
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…`;
}

function redactText(value) {
  return clip(String(value ?? ''))
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, (hit) => {
      const digits = hit.replace(/\D/g, '');
      if (digits.length < 8) return hit;
      return `[phone:${digits.slice(-4)}]`;
    });
}

function createMemorySink() {
  const records = [];
  return {
    kind: 'memory',
    records,
    async write(record) {
      records.push(record);
    },
  };
}

function createJsonlSink(filePath) {
  const target = path.resolve(filePath);
  return {
    kind: 'jsonl',
    filePath: target,
    async write(record) {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.appendFile(target, `${JSON.stringify(record)}\n`, 'utf8');
    },
  };
}

function createSupabaseSink() {
  let warned = false;
  return {
    kind: 'supabase',
    async write(record) {
      let supabase;
      try {
        ({ supabase } = require('../lib/supabaseClient'));
      } catch (err) {
        if (!warned) {
          warned = true;
          console.warn('[voice-trace] supabase client unavailable:', err?.message || err);
        }
        return;
      }
      const tenant = record.tenantId && /^[0-9a-f-]{36}$/i.test(record.tenantId)
        ? record.tenantId
        : null;
      const { error } = await supabase.from('voice_turn_traces').insert({
        call_id: String(record.callId || 'unknown'),
        tenant_id: tenant,
        turn_index: record.turnIndex == null ? null : Number(record.turnIndex),
        record_kind: record.recordKind,
        schema_version: Number(record.schemaVersion || SCHEMA_VERSION),
        pii: String(record.pii || 'transcript'),
        payload: record,
      });
      if (error && !warned) {
        warned = true;
        console.warn('[voice-trace] insert failed:', error.message);
      }
    },
  };
}

function resolveSink(env = process.env) {
  const choice = String(env.VOICE_TRACE_SINK || 'auto').toLowerCase();
  if (choice === 'memory') return createMemorySink();
  if (choice === 'jsonl') {
    return createJsonlSink(env.VOICE_TRACE_JSONL || path.join('data', 'voice-traces.jsonl'));
  }
  if (choice === 'supabase') return createSupabaseSink();
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return createSupabaseSink();
  if (env.VOICE_TRACE_JSONL) return createJsonlSink(env.VOICE_TRACE_JSONL);
  return createMemorySink();
}

function noopTrace() {
  const noop = () => null;
  return {
    enabled: false,
    beginTurn: noop,
    noteStt: noop,
    noteTurnEnd: noop,
    noteLanguage: noop,
    noteModelRequest: noop,
    noteModelOutput: noop,
    noteTransform: noop,
    noteCanned: noop,
    noteTts: noop,
    noteBarge: noop,
    noteCall: noop,
    commitTurn: noop,
    finishCall: async () => null,
  };
}

function createVoiceTrace(opts = {}) {
  const enabled = opts.enabled != null ? Boolean(opts.enabled) : voiceTraceEnabled(opts.env);
  if (!enabled) return noopTrace();

  const sink = opts.sink || resolveSink(opts.env);
  const callIdOf = typeof opts.callId === 'function' ? opts.callId : () => opts.callId;
  const tenantOf = typeof opts.tenantId === 'function' ? opts.tenantId : () => opts.tenantId;
  const voiceOf = typeof opts.voiceId === 'function' ? opts.voiceId : () => opts.voiceId || null;

  let turnIndex = 0;
  let open = null;
  const sttBuffer = [];
  const callStages = [];
  let turnCount = 0;
  let pendingFirstTokenAt = null;
  const pendingWrites = new Set();
  const startedAt = new Date().toISOString();

  function callId() {
    return String(callIdOf() || 'unknown');
  }

  function tenantId() {
    const id = tenantOf();
    return id ? String(id) : null;
  }

  function pushBuffered(stage) {
    if (stage.stage === 'stt' && stage.kind === 'interim' && sttBuffer.length >= STT_BUFFER_CAP) {
      const idx = sttBuffer.findIndex((row) => row.stage === 'stt' && row.kind === 'interim');
      if (idx >= 0) sttBuffer.splice(idx, 1);
    }
    sttBuffer.push(stage);
  }

  function pushStage(stage) {
    if (!open) {
      if (stage.stage === 'stt' || stage.stage === 'turn_end' || stage.stage === 'barge_in') {
        pushBuffered(stage);
      }
      return;
    }
    open.stages.push(stage);
  }

  function beginTurn({ callerText = '', language = null } = {}) {
    if (open) commitTurn({ outcome: 'superseded' });
    turnIndex += 1;
    const lang = language && typeof language === 'object' ? language : null;
    open = {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      recordKind: 'turn',
      callId: callId(),
      tenantId: tenantId(),
      turnIndex,
      pii: 'transcript',
      at: new Date().toISOString(),
      caller: {
        text: redactText(callerText),
        language: lang?.current || lang?.language || null,
        confidence: lang?.confidence ?? null,
      },
      stages: sttBuffer.splice(0, sttBuffer.length),
    };
    return open;
  }

  function noteStt(evt = {}) {
    const tokens = (Array.isArray(evt.tokens) ? evt.tokens : []).slice(0, TOKEN_CAP).map((token) => ({
      text: redactText(token?.text || ''),
      final: Boolean(token?.final),
      language: token?.language || null,
      startMs: token?.startMs ?? null,
      endMs: token?.endMs ?? null,
    }));
    pushStage({
      stage: 'stt',
      kind: evt.isFinal ? 'final' : 'interim',
      text: redactText(evt.text || ''),
      tokens,
      at: new Date().toISOString(),
    });
  }

  function noteTurnEnd(info = {}) {
    pushStage({
      stage: 'turn_end',
      decision: String(info.decision || 'flush'),
      reason: String(info.reason || ''),
      at: new Date().toISOString(),
    });
  }

  function noteLanguage(info = {}) {
    pushStage({
      stage: 'language',
      detected: info.detected || null,
      sticky: info.sticky || null,
      confidence: info.confidence ?? null,
    });
  }

  function noteModelRequest(info = {}) {
    pushStage({
      stage: 'model',
      phase: 'request',
      provider: String(info.provider || 'gemini'),
      model: String(info.model || ''),
      promptId: String(info.promptId || ''),
      promptVersion: String(info.promptVersion || ''),
      language: info.language || null,
    });
  }

  function noteModelOutput(info = {}) {
    pendingFirstTokenAt = info.firstTokenAt || null;
    pushStage({
      stage: 'model',
      phase: 'output',
      provider: info.provider || null,
      model: info.model || null,
      promptId: info.promptId || null,
      promptVersion: info.promptVersion || null,
      language: info.language || null,
      outputText: redactText(info.outputText || ''),
      chars: Number.isFinite(info.chars) ? info.chars : String(info.outputText || '').length,
      spokenEmitted: info.spokenEmitted ?? null,
    });
  }

  function noteTransform(info = {}) {
    const before = String(info.before || '');
    const after = String(info.after || '');
    if (before.trim() === after.trim() && !info.force) return;
    pushStage({
      stage: 'transform',
      name: String(info.stage || info.name || 'speech'),
      reason: String(info.reason || (after.trim() ? 'rewritten' : 'dropped')),
      before: redactText(before),
      after: redactText(after),
      dropped: typeof info.dropped === 'boolean' ? info.dropped : !after.trim(),
    });
  }

  function noteCanned(info = {}) {
    pushStage({
      stage: 'canned',
      path: String(info.path || 'canned'),
      text: redactText(info.text || ''),
    });
  }

  function noteTts(info = {}) {
    pushStage({
      stage: 'tts',
      text: redactText(info.text || ''),
      before: info.before != null ? redactText(info.before) : null,
      language: info.language || null,
      voiceId: info.voiceId || voiceOf() || null,
    });
  }

  function noteBarge(info = {}) {
    pushStage({
      stage: 'barge_in',
      reason: String(info.reason || ''),
      at: new Date().toISOString(),
    });
  }

  function noteCall(stage = {}) {
    if (!stage || typeof stage !== 'object') return;
    callStages.push(stage);
  }

  function commitTurn(extra = {}) {
    if (!open) return null;
    const turnStartedAt = Number(extra.turnStartedAt || 0);
    const firstTokenMs =
      pendingFirstTokenAt && turnStartedAt
        ? Math.max(0, pendingFirstTokenAt - turnStartedAt)
        : extra.callerStopToModelFirstTokenMs ?? null;
    const pcm = extra.latency?.first_pcm_ms ?? extra.callerStopToFirstTtsPcmMs ?? null;
    open.stages.push({
      stage: 'latency',
      callerStopToModelFirstTokenMs: firstTokenMs,
      callerStopToFirstTtsPcmMs: pcm == null || pcm < 0 ? null : pcm,
      structuredFirstSentenceMs: extra.structuredFirstSentenceMs ?? null,
    });
    open.stages.push({ stage: 'outcome', value: String(extra.outcome || 'ok') });
    open.voiceId = voiceOf() || null;
    const record = open;
    open = null;
    pendingFirstTokenAt = null;
    turnCount += 1;
    const write = Promise.resolve(sink.write(record)).catch((err) => {
      console.warn('[voice-trace] write failed:', err?.message || err);
    });
    pendingWrites.add(write);
    write.finally(() => pendingWrites.delete(write));
    return record;
  }

  async function finishCall() {
    if (open) commitTurn({ outcome: 'call_end' });
    if (pendingWrites.size) await Promise.all([...pendingWrites]);
    const record = {
      schema: CALL_SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      recordKind: 'call',
      callId: callId(),
      tenantId: tenantId(),
      turnIndex: null,
      pii: 'transcript',
      startedAt,
      endedAt: new Date().toISOString(),
      turnCount,
      voiceId: voiceOf() || null,
      sttModel: process.env.SONIOX_STT_MODEL || 'stt-rt-v5',
      ttsModel: process.env.SONIOX_TTS_MODEL || 'tts-rt-v2',
      stages: callStages.slice(),
    };
    await sink.write(record);
    return record;
  }

  function guard(fn) {
    return (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        console.warn('[voice-trace]', err?.message || err);
        return null;
      }
    };
  }

  return {
    enabled: true,
    sink,
    beginTurn: guard(beginTurn),
    noteStt: guard(noteStt),
    noteTurnEnd: guard(noteTurnEnd),
    noteLanguage: guard(noteLanguage),
    noteModelRequest: guard(noteModelRequest),
    noteModelOutput: guard(noteModelOutput),
    noteTransform: guard(noteTransform),
    noteCanned: guard(noteCanned),
    noteTts: guard(noteTts),
    noteBarge: guard(noteBarge),
    noteCall: guard(noteCall),
    commitTurn: guard(commitTurn),
    finishCall: async () => {
      try {
        return await finishCall();
      } catch (err) {
        console.warn('[voice-trace] finish failed:', err?.message || err);
        return null;
      }
    },
  };
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readStoredTurns(callId, opts = {}) {
  const id = String(callId || '').trim();
  if (!id) return [];
  if (opts.file) {
    return readJsonl(opts.file).filter(
      (row) => row.callId === id && row.recordKind === 'turn'
    );
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --file');
  }
  const { supabase } = require('../lib/supabaseClient');
  const { data, error } = await supabase
    .from('voice_turn_traces')
    .select('payload,turn_index,record_kind')
    .eq('call_id', id)
    .eq('record_kind', 'turn')
    .order('turn_index', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map((row) => row.payload).filter(Boolean);
}

module.exports = {
  SCHEMA,
  CALL_SCHEMA,
  SCHEMA_VERSION,
  voiceTraceEnabled,
  redactText,
  createMemorySink,
  createJsonlSink,
  createSupabaseSink,
  createVoiceTrace,
  readJsonl,
  readStoredTurns,
};
