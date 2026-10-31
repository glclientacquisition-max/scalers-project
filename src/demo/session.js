'use strict';

// Browser demo session. PCM in, PCM out, at 16 kHz, through the same STT,
// Brain, and TTS factories as a phone call. It does not apply phone gain,
// does not drain an inbound setup burst, does not speak the drachtio
// subprotocol, and does not record. 180 s and 30 s idle go through
// createCallLimits for this session only. Reconnect is not supported.

const crypto = require('crypto');
const { createSttSilenceGate, frameRms } = require('../speech/sttSilenceGate');
const { createCallLimits } = require('../speech/callLimits');
const { createCallMeter } = require('../speech/callMeter');
const { MAX_SEC, demoRecordOn } = require('./flags');
const { visitorHash } = require('./guards');
const { createDemoCodec } = require('./codec');
const { fixtureProfile, acceptStoredProfile, openerFor } = require('./profiles');
const { createDemoMeter, getDemoLedger } = require('./meter');
const pipeline = require('./pipeline');

const IDLE_MS = 30000;
const BARGE_RMS = 300;
const GOODBYE = Object.freeze({
  en: 'Thank you. Goodbye.',
  sw: 'Asante. Kwaheri.',
});
const CAP = Object.freeze({
  en: 'This demo has reached its limit for now. Please try again later. Goodbye.',
  sw: 'Onyesho hili limefika kikomo kwa sasa. Tafadhali jaribu tena baadaye. Kwaheri.',
});
const KILL = Object.freeze({
  en: 'The demo is paused. Please try again later. Goodbye.',
  sw: 'Onyesho limepumzishwa. Tafadhali jaribu tena baadaye. Kwaheri.',
});
const END_REASONS = new Set(['max_time', 'idle', 'user', 'cap', 'kill', 'error']);

function createDemoSession(opts) {
  const ws = opts.ws;
  const claims = opts.claims || {};
  const lang0 = claims.lang === 'sw' ? 'sw' : 'en';
  const codecKind = opts.codec;
  const env = opts.env || process.env;
  const log = opts.log || (() => {});
  const now = opts.now || (() => Date.now());
  const maxMs = Number.isFinite(opts.maxMs) ? opts.maxMs : MAX_SEC * 1000;
  const idleMs = Number.isFinite(opts.idleMs) ? opts.idleMs : IDLE_MS;
  const tickMs = Number.isFinite(opts.tickMs)
    ? opts.tickMs
    : Math.min(1000, Math.max(50, Math.round(Math.min(maxMs, idleMs))));
  const createStt = opts.createStt || pipeline.createDemoStt;
  const createTts = opts.createTts || pipeline.createDemoTts;
  const brain = opts.brain || pipeline.createDemoBrain;
  const loadProfile = opts.loadProfile || defaultLoadProfile;
  const ledger = opts.ledger === undefined ? getDemoLedger() : opts.ledger;
  const sessionId = `demo_${crypto.randomUUID()}`;
  const startedAt = now();
  const usage = createDemoMeter();
  const byteMeter = createCallMeter({ callSid: sessionId });
  const salt = String(env.DEMO_IP_SALT || '');
  const deviceHash = salt && claims.device_id ? visitorHash(salt, 'device', claims.device_id) : null;

  let lang = lang0;
  let profile = fixtureProfile(claims.tenant);
  let codec = null;
  let stt = null;
  let tts = null;
  let sttGate = null;
  let playGen = 0;
  let activeGen = 0;
  let speaking = false;
  let stopReason = null;
  let cleaned = false;
  let loggedEnd = false;
  let recorded = false;
  let outBuf = Buffer.alloc(0);
  let turnChain = Promise.resolve();

  const limits = createCallLimits({
    env,
    maxCallMs: maxMs,
    deadAirMs: idleMs,
    now,
    tickMs,
    setInterval: opts.setInterval,
    clearInterval: opts.clearInterval,
    onTick() {
      if (stopReason) return true;
      if (env.DEMO_ENABLED !== 'on') {
        finish('kill');
        return true;
      }
      if (ledger && ledger.blocked()) {
        finish('cap');
        return true;
      }
      return false;
    },
    onLimit(kind) {
      if (kind === 'maxCall') finish('max_time');
      else if (kind === 'deadAir') finish('idle');
    },
  });

  function sendJson(payload) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      /* socket already closing */
    }
  }

  function meta(extra) {
    const fields = {
      session_id: sessionId,
      tenant: claims.tenant || null,
      tenant_id: profile && profile.id || null,
      lang,
      codec: codecKind,
      ip_hash: claims.ip_hash || null,
      device_hash: deviceHash,
      origin: opts.origin || null,
      recording: false,
      record: demoRecordOn(env) ? 'ignored' : 'off',
    };
    if (extra) Object.assign(fields, extra);
    const safe = {};
    for (const key of [
      'session_id', 'tenant', 'tenant_id', 'lang', 'codec', 'ip_hash',
      'device_hash', 'origin', 'recording', 'record', 'reason', 'duration_ms',
      'minutes', 'cost_usd',
    ]) {
      if (fields[key] != null && fields[key] !== '') safe[key] = fields[key];
    }
    return safe;
  }

  function writeLog(kind, extra) {
    try {
      log(`${kind} ${JSON.stringify(meta(extra))}`);
    } catch {
      /* logging must not break the socket */
    }
  }

  function clearTimers() {
    try { limits.stop(); } catch { /* ignore */ }
  }

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearTimers();
    outBuf = Buffer.alloc(0);
    try { tts && tts.cancel(); } catch { /* ignore */ }
    try { tts && tts.close(); } catch { /* ignore */ }
    try { stt && stt.close(); } catch { /* ignore */ }
    try { codec && codec.close(); } catch { /* ignore */ }
  }

  function closingLine(why) {
    const pack = why === 'cap' ? CAP : why === 'kill' ? KILL : (why === 'max_time' || why === 'idle') ? GOODBYE : null;
    if (!pack) return '';
    return pack[lang] || pack.en;
  }

  function sendWire(frames, gen) {
    for (const frame of frames) {
      if (gen !== playGen || !frame || !frame.length) return;
      if (!ws || ws.readyState !== 1) return;
      try {
        ws.send(frame, { binary: true });
      } catch {
        return;
      }
    }
  }

  function emitPcm(pcm, gen) {
    if (!pcm || !pcm.length || gen !== playGen || !codec) return;
    outBuf = outBuf.length ? Buffer.concat([outBuf, pcm]) : pcm;
    const need = codec.pcmFrameBytes;
    while (outBuf.length >= need && gen === playGen) {
      const slice = Buffer.from(outBuf.subarray(0, need));
      outBuf = outBuf.subarray(need);
      let frames = [];
      try {
        frames = codec.encode(slice);
      } catch {
        sendJson({ type: 'error', reason: 'audio', message: 'Could not send audio.' });
        return;
      }
      sendWire(frames, gen);
    }
  }

  function onTtsAudio(pcm) {
    const buf = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
    if (buf.length) {
      usage.noteTts('', buf.length);
      byteMeter.tts('', buf.length);
    }
    if (!speaking || activeGen !== playGen) return;
    emitPcm(buf, activeGen);
  }

  function noteSpend() {
    if (stopReason || !ledger) return;
    if (ledger.blocked()) ledger.touch();
  }

  async function speak(text, stateName, { closing = false } = {}) {
    const line = String(text || '').trim();
    if (!line || !tts) return;
    usage.noteTts(line, 0);
    byteMeter.tts(line, 0);
    const gen = ++playGen;
    activeGen = gen;
    speaking = true;
    outBuf = Buffer.alloc(0);
    const streamId = `${sessionId}:${gen}`;
    sendJson({
      type: 'assistant_audio',
      codec: codecKind,
      sample_rate: 16000,
      frame_ms: 20,
      stream_id: streamId,
    });
    sendJson({ type: 'state', state: stateName });
    sendJson({ type: 'caption', role: 'assistant', text: line, final: true, lang });
    try {
      await tts.speak(line, { language: lang, callLanguage: lang });
    } finally {
      if (activeGen === gen) {
        speaking = false;
        outBuf = Buffer.alloc(0);
        if (!closing && !stopReason) sendJson({ type: 'state', state: 'listening' });
      }
    }
    noteSpend();
  }

  function barge() {
    if (!speaking) return;
    playGen += 1;
    speaking = false;
    outBuf = Buffer.alloc(0);
    try { tts && tts.cancel(); } catch { /* ignore */ }
    sendJson({ type: 'state', state: 'listening' });
  }

  function feedStt(pcm) {
    if (!stt || !sttGate || !pcm || !pcm.length) return;
    const gated = sttGate.admit(pcm, { ttsSpeaking: speaking });
    if (gated.voiced) limits.activity();
    for (const frame of gated.send) {
      usage.noteStt(frame.length);
      try { stt.sendAudio(frame); } catch { /* ignore */ }
    }
    if (gated.keepalive && typeof stt.sendKeepalive === 'function') {
      try { stt.sendKeepalive(); } catch { /* ignore */ }
    }
    if (speaking && gated.voiced && frameRms(pcm) >= BARGE_RMS) barge();
    noteSpend();
  }

  function ensureOn() {
    if (stopReason) return false;
    if (env.DEMO_ENABLED !== 'on') {
      finish('kill');
      return false;
    }
    if (ledger && ledger.blocked()) {
      finish('cap');
      return false;
    }
    return true;
  }

  function onBinary(buf) {
    if (!ensureOn() || !codec) return;
    let pcm;
    try {
      pcm = codec.decode(buf);
    } catch {
      sendJson({ type: 'error', reason: 'audio', message: 'Bad audio frame.' });
      return;
    }
    if (pcm && pcm.length) feedStt(pcm);
  }

  function onCallerFinal(text) {
    const spoken = String(text || '').trim();
    if (!spoken || !ensureOn()) return;
    turnChain = turnChain.then(() => runTurn(spoken)).catch(() => {});
  }

  async function runTurn(spoken) {
    if (stopReason) return;
    sendJson({ type: 'state', state: 'thinking' });
    let reply;
    try {
      reply = await brain({ text: spoken, lang, profile, callSid: sessionId });
    } catch {
      sendJson({ type: 'error', reason: 'brain', message: lang === 'sw' ? 'Tafadhali sema tena.' : 'Please say that again.' });
      if (!stopReason) sendJson({ type: 'state', state: 'listening' });
      return;
    }
    if (stopReason) return;
    if (reply && (reply.lang === 'en' || reply.lang === 'sw')) lang = reply.lang;
    const line = typeof reply === 'string' ? reply : reply && reply.text;
    usage.noteModel(spoken, line || '');
    noteSpend();
    if (stopReason) return;
    if (!line) {
      sendJson({ type: 'state', state: 'listening' });
      return;
    }
    await speak(line, 'speaking');
    if (reply && reply.end && !stopReason) await finish('user');
  }

  function onText(raw) {
    if (!ensureOn()) return;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendJson({ type: 'error', reason: 'protocol', message: 'Bad message.' });
      return;
    }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      sendJson({ type: 'error', reason: 'protocol', message: 'Bad message.' });
      return;
    }
    if (msg.type === 'end') {
      finish('user');
      return;
    }
    if (msg.type === 'caption' || msg.type === 'session' || msg.type === 'assistant_audio') {
      return;
    }
  }

  function onSttEvent(evt) {
    if (!evt || stopReason) return;
    if (evt.type === 'transcript' && evt.text) {
      sendJson({
        type: 'caption',
        role: 'caller',
        text: String(evt.text),
        final: Boolean(evt.isFinal),
        lang,
      });
      if (evt.isFinal) onCallerFinal(evt.text);
      return;
    }
    if (evt.type === 'error') {
      sendJson({ type: 'error', reason: 'stt', message: 'Speech is unavailable.' });
    }
  }

  async function settle(why) {
    const durationMs = Math.max(0, now() - startedAt);
    const summary = usage.summary(durationMs);
    if (!recorded) {
      recorded = true;
      try { byteMeter.finish(sttGate && sttGate.stats || {}, now()); } catch { /* ignore */ }
      if (ledger) {
        try {
          await ledger.record({ sessionId, ...summary });
        } catch {
          /* the ledger keeps the in-memory row when the store write fails */
        }
      }
    }
    if (!loggedEnd) {
      loggedEnd = true;
      writeLog('demo_session_end', {
        reason: why,
        duration_ms: durationMs,
        minutes: summary.minutes,
        cost_usd: summary.costUsd,
      });
    }
  }

  async function finish(reason) {
    const why = END_REASONS.has(reason) ? reason : 'error';
    if (stopReason) return;
    stopReason = why;
    clearTimers();
    const line = closingLine(why);
    if (line && tts && !cleaned) {
      try {
        await speak(line, 'speaking', { closing: true });
      } catch {
        /* still close */
      }
    }
    cleanup();
    await settle(why);
    if (ws && ws.readyState === 1) {
      sendJson({ type: 'end', reason: why });
      try { ws.close(why === 'error' ? 1011 : 1000, why); } catch { /* ignore */ }
    }
  }

  function wire() {
    ws.on('message', (data, isBinary) => {
      if (stopReason) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || []);
      if (isBinary) {
        onBinary(buf);
        return;
      }
      const text = buf.toString('utf8');
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) onText(trimmed);
      else onBinary(buf);
    });
    ws.on('close', () => {
      if (stopReason) return;
      stopReason = 'user';
      clearTimers();
      cleanup();
      settle('user');
    });
    ws.on('error', () => {});
  }

  async function start() {
    wire();
    if (!profile) {
      sendJson({ type: 'error', reason: 'tenant', message: 'Demo paused.' });
      await finish('error');
      return;
    }
    try {
      const stored = await loadProfile(profile);
      const accepted = acceptStoredProfile(stored, profile);
      if (accepted) profile = { ...profile, ...accepted, id: profile.id, openers: profile.openers };
    } catch {
      /* fixture profile stays */
    }
    try {
      codec = createDemoCodec(codecKind);
    } catch {
      sendJson({ type: 'error', reason: 'codec', message: 'This browser audio format is not available.' });
      await finish('error');
      return;
    }
    sttGate = createSttSilenceGate(
      opts.silenceGate == null ? { env } : { enabled: Boolean(opts.silenceGate), env }
    );
    try {
      stt = createStt({ callSid: sessionId, onEvent: onSttEvent });
      tts = createTts({
        callSid: sessionId,
        onAudio: onTtsAudio,
        onEvent() {},
        shouldRespeak: () => activeGen === playGen && !stopReason,
      });
    } catch {
      sendJson({ type: 'error', reason: 'stt', message: 'Speech is unavailable.' });
      await finish('error');
      return;
    }
    limits.start();
    if (ledger && typeof ledger.ready === 'function') {
      try { await ledger.ready(); } catch { /* in-memory totals still apply */ }
    }
    if (env.DEMO_ENABLED !== 'on') {
      await finish('kill');
      return;
    }
    if (ledger && ledger.blocked()) {
      await finish('cap');
      return;
    }
    if (ledger && typeof ledger.attach === 'function') {
      ledger.attach(sessionId, {
        costUsd: () => usage.costUsd(),
        minutes: () => Math.max(0, (now() - startedAt) / 60000),
        onCap: () => { finish('cap'); },
      });
    }
    sendJson({
      type: 'session',
      session_id: sessionId,
      tenant: claims.tenant,
      tenant_id: profile.id,
      lang,
      codec: codecKind,
      sample_rate: 16000,
      frame_ms: 20,
      max_sec: Math.round(maxMs / 1000),
      recording: false,
    });
    // DEMO_RECORD is ignored. Recording stays off until a later decision.
    writeLog('demo_session_start');
    const greeting = openerFor(profile, lang);
    try {
      await speak(greeting, 'greeting');
    } catch {
      sendJson({ type: 'error', reason: 'tts', message: 'Speech is unavailable.' });
      await finish('error');
    }
  }

  return { sessionId, start, finish };
}

async function defaultLoadProfile(local) {
  let db;
  try {
    db = require('../db');
  } catch {
    return null;
  }
  if (!db || typeof db.getTenantProfile !== 'function') return null;
  const stored = await db.getTenantProfile({ tenantId: local.id });
  return stored;
}

module.exports = {
  IDLE_MS,
  BARGE_RMS,
  GOODBYE,
  CAP,
  KILL,
  END_REASONS,
  createDemoSession,
};
