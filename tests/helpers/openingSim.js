// VOICE_OPENING_V2 e2e preload: tests/helpers/mediaCallSim.js (fake Soniox
// STT/TTS, seeded greeting PCM cache) plus instant tenant/caller reads, so a
// forked server.js greets the way a live call does with a warm cache.
//
//   node -r ./tests/helpers/openingSim.js server.js
//
// The tenant comes from the callSid: HD_sim_<tenant>_<who>_<n>, where tenant
// is aris|esga|jirani (tests/fixtures/openingTenants.js) and who is new|ret
// (returning, name not confirmed)|retnamed (name confirmed on a past call).
// OPENING_SIM_PCM_MS sets the cached clip length (default 300 ms) so a test
// can talk over a long greeting. OPENING_SIM_PROFILE_DELAY_MS makes every
// tenant profile read that slow (the prod DB load the webhook prefetch hides).
// The incoming-call webhook (POST /) works too: tenant by destinationNumber
// (SIM_DIDS), caller kind by callerNumber (PHONE). No Gemini or Soniox
// network; Supabase is a dead port, nothing is written to any database.
// OPENING_SIM_SHARED_DIR mocks Platform's #844 helpers (probeGreetingSchema,
// markCallGreeted, getCallResumeState, updateLastAgentLine(sid, line, {cut}),
// markLastLineCut, markCallNoticeGiven, bumpStreamSeq) on files in that
// directory, so two forked replicas share one "calls row" per callSid; the
// claim is an O_EXCL create, atomic across processes like the SQL
// update ... where greeted_at is null. OPENING_SIM_SHARED_PROBE: 'calls,contacts'
// (default), 'calls', 'none' (both false) or 'absent' (no probe helper).
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const greetingCache = require(path.join(ROOT, 'src/speech/greetingPcmCache'));
const realLookup = greetingCache.lookupGreetingPcm;

require('./mediaCallSim');

const send = (msg) => {
  try {
    if (process.send) process.send(msg);
  } catch {
    /* parent gone */
  }
};

const pcmMs = Number(process.env.OPENING_SIM_PCM_MS) || 300;
greetingCache.lookupGreetingPcm = (args) => {
  const found = realLookup(args);
  if (!found.pcm && found.key) {
    greetingCache.putGreetingPcm(found.key, Buffer.alloc(Math.round(16000 * 2 * (pcmMs / 1000))), { tenantId: null });
    send({ ev: 'greeting_seeded', text: args?.text || '' });
    return realLookup(args);
  }
  return found;
};

const { TENANTS, ALWAYS_OPEN } = require(path.join(ROOT, 'tests/fixtures/openingTenants'));
const { tenantProfileFromRow } = require(path.join(ROOT, 'src/tenantProfile'));
const db = require(path.join(ROOT, 'src/db'));

function parseSid(callSid) {
  const m = /^HD_sim_([a-z]+)_([a-z]+)_/.exec(String(callSid || ''));
  return { tenant: m && TENANTS[m[1]] ? m[1] : 'jirani', who: m ? m[2] : 'new' };
}

// The caller kind rides the phone number, so concurrent calls stay separate.
const PHONE = { new: '+254700000001', ret: '+254700000011', retnamed: '+254700000022' };

db.getCall = async (callSid) => {
  const { tenant, who } = parseSid(callSid);
  return { call_sid: callSid, tenant_id: TENANTS[tenant].id, from_number: PHONE[who] || PHONE.new, status: 'in-progress' };
};
const SIM_DIDS = { '+254709000001': 'aris', '+254709000002': 'esga', '+254709000003': 'jirani' };
const profileDelayMs = Number(process.env.OPENING_SIM_PROFILE_DELAY_MS) || 0;

db.getTenantProfile = async ({ callSid, toNumber, tenantId } = {}) => {
  let tenant = parseSid(callSid).tenant;
  if (!callSid && SIM_DIDS[toNumber]) tenant = SIM_DIDS[toNumber];
  if (!callSid && tenantId) tenant = Object.keys(TENANTS).find((k) => TENANTS[k].id === tenantId) || tenant;
  if (profileDelayMs) await new Promise((r) => setTimeout(r, profileDelayMs));
  send({ ev: 'profile_read', callSid: callSid || '', toNumber: toNumber || '', tenant });
  return tenantProfileFromRow({ ...TENANTS[tenant], hours_schedule: ALWAYS_OPEN, is_active: true });
};

// Incoming-call webhook path: no directory rows, so the legacy path runs.
db.listActiveTenantDids = async () => Object.keys(SIM_DIDS);
db.inboundTenantLine = async () => null;
db.packageInboundOpen = async () => ({ open: true });
db.upsertCall = async ({ callSid } = {}) => ({ call_sid: callSid });
// Tool writes never reach a database: the save is recorded as an event.
db.saveCallerInfo = async ({ callSid, name, reason } = {}) => {
  send({ ev: 'db_write', fn: 'saveCallerInfo', callSid, name: name || null, reason: reason || null, at: Date.now() });
  return { name: name || null, reason: reason || null };
};
// Closed-line guard before tool writes: the sim tenants are open.
db.tenantLineClosed = async (tenantId) => ({ closed: false, reason: 'active', tenantId });
// Fast inbound path (the prod default): directory rows for the sim DIDs, so
// the webhook knows the tenant before Stream XML goes out.
db.listInboundTenantRows = async () => ({
  rows: Object.entries(SIM_DIDS).map(([did, key]) => ({
    id: TENANTS[key].id,
    business_name: TENANTS[key].business_name,
    sautikit_virtual_number: did,
    is_active: true,
  })),
  packageColumns: false,
});
db.getCallerMemory = async ({ phone } = {}) => {
  if (phone !== PHONE.ret && phone !== PHONE.retnamed) return null;
  return {
    phone,
    name: 'Alvin',
    fileOwnerName: 'Alvin',
    sharedLine: false,
    greetByName: true,
    alternateNames: [],
    nameConfirmed: phone === PHONE.retnamed,
  };
};

const sharedDir = process.env.OPENING_SIM_SHARED_DIR || '';
if (sharedDir) {
  const fs = require('fs');
  const file = (sid, ext) => path.join(sharedDir, `${String(sid).replace(/[^A-Za-z0-9_-]/g, '_')}.${ext}`);
  const readRow = (sid) => {
    try {
      return JSON.parse(fs.readFileSync(file(sid, 'json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const writeRow = (sid, patch) => {
    const row = { ...(readRow(sid) || {}), ...patch };
    const tmp = `${file(sid, 'json')}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(row));
    fs.renameSync(tmp, file(sid, 'json'));
    return row;
  };
  const isSimCall = (sid) => /^HD_sim_/.test(String(sid || ''));
  const delay = Number(process.env.OPENING_SIM_SHARED_RTT_MS) || 0;
  const rtt = () => (delay ? new Promise((r) => setTimeout(r, delay)) : null);
  const probe = (process.env.OPENING_SIM_SHARED_PROBE || 'calls,contacts').toLowerCase();
  if (probe === 'absent') {
    // #844 @962fb6e6 shape: no probe helper, even when this tree's db.js
    // (#844 @d4609435 merged in) has the real one.
    delete db.probeGreetingSchema;
  } else {
    db.probeGreetingSchema = async () => {
      send({ ev: 'db_helper', fn: 'probeGreetingSchema' });
      return { calls: /\bcalls\b/.test(probe), contacts: /\bcontacts\b/.test(probe) };
    };
  }
  // Shapes as #844 @d4609435 (src/db.js): { ok, updated }, never throw.
  db.markCallNoticeGiven = async (callSid) => {
    send({ ev: 'db_helper', fn: 'markCallNoticeGiven', callSid });
    if (!isSimCall(callSid)) return { ok: true, updated: 0 };
    writeRow(callSid, { notice_given: true });
    return { ok: true, updated: 1 };
  };
  db.markLastLineCut = async (callSid, cut = true) => {
    send({ ev: 'db_helper', fn: 'markLastLineCut', callSid, cut: cut === true });
    if (!isSimCall(callSid)) return { ok: true, updated: 0 };
    writeRow(callSid, { last_line_cut: cut === true });
    return { ok: true, updated: 1 };
  };
  db.markCallGreeted = async ({ callSid, lastAgentLine, noticeGiven } = {}) => {
    await rtt();
    send({ ev: 'db_helper', fn: 'markCallGreeted', callSid });
    if (!isSimCall(callSid)) return { ok: true, won: false, missing: true };
    try {
      fs.writeFileSync(file(callSid, 'claim'), String(process.pid), { flag: 'wx' });
    } catch {
      return { ok: true, won: false, greetedAt: readRow(callSid)?.greeted_at || null };
    }
    const row = writeRow(callSid, {
      greeted_at: new Date().toISOString(),
      ...(lastAgentLine ? { last_agent_line: String(lastAgentLine).slice(0, 500) } : {}),
      ...(noticeGiven === true ? { notice_given: true } : {}),
    });
    return { ok: true, won: true, greetedAt: row.greeted_at };
  };
  db.getCallResumeState = async (callSid) => {
    await rtt();
    send({ ev: 'db_helper', fn: 'getCallResumeState', callSid });
    const r = readRow(callSid);
    if (!r) return null;
    return {
      greetedAt: r.greeted_at || null,
      lastAgentLine: r.last_agent_line || null,
      lastLineCut: r.last_line_cut === true,
      noticeGiven: r.notice_given === true,
      streamSeq: r.stream_seq || 0,
    };
  };
  db.updateLastAgentLine = async (callSid, line, { cut = false } = {}) => {
    send({ ev: 'db_helper', fn: 'updateLastAgentLine', callSid, cut: cut === true, line: String(line || '') });
    const text = String(line || '').trim().slice(0, 500);
    if (!text) return { ok: false, updated: 0, skipped: 'no_call_sid_or_line' };
    if (!isSimCall(callSid)) return { ok: true, updated: 0 };
    writeRow(callSid, { last_agent_line: text, last_line_cut: cut === true });
    return { ok: true, updated: 1 };
  };
  db.bumpStreamSeq = async (callSid) => {
    send({ ev: 'db_helper', fn: 'bumpStreamSeq', callSid });
    if (!isSimCall(callSid)) return { ok: true, missing: true, streamSeq: null };
    const row = writeRow(callSid, { stream_seq: ((readRow(callSid) || {}).stream_seq || 0) + 1, last_stream_at: new Date().toISOString() });
    return { ok: true, streamSeq: row.stream_seq };
  };
}
// contacts.last_language for returning callers: OPENING_SIM_LAST_LANGUAGE.
const simLastLanguage = process.env.OPENING_SIM_LAST_LANGUAGE || '';
if (simLastLanguage) {
  const base = db.getCallerMemory;
  db.getCallerMemory = async (args) => {
    const card = await base(args);
    return card ? { ...card, lastLanguage: simLastLanguage } : card;
  };
}

// OPENING_SIM_GEMINI_SCRIPT: a fake @google/genai (no network). JSON list of
// [regex, reply]; the first regex matching the caller's last message picks
// the model's reply text (tool markers allowed), streamed in two chunks.
// Unset: Gemini stays unconfigured, as in every other sim test.
const geminiScript = process.env.OPENING_SIM_GEMINI_SCRIPT || '';
if (geminiScript) {
  const rules = JSON.parse(geminiScript).map(([re, reply]) => [new RegExp(re, 'i'), String(reply)]);
  const lastUserText = (contents) => {
    const list = Array.isArray(contents) ? contents : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.role === 'user') return (list[i].parts || []).map((p) => p?.text || '').join(' ');
    }
    return '';
  };
  const replyFor = (contents) => {
    const said = lastUserText(contents);
    const hit = rules.find(([re]) => re.test(said));
    send({ ev: 'gemini', said, reply: hit ? hit[1] : '' });
    return hit ? hit[1] : 'Sawa.';
  };
  const chunk = (text) => ({ text, candidates: [{ content: { role: 'model', parts: [{ text }] } }] });
  const genai = require('@google/genai');
  class FakeGenAI {
    constructor() {
      this.models = {
        async generateContentStream({ contents } = {}) {
          const reply = replyFor(contents);
          const mid = Math.max(1, Math.floor(reply.length / 2));
          return (async function* gen() {
            await new Promise((r) => setTimeout(r, 30));
            yield chunk(reply.slice(0, mid));
            yield chunk(reply.slice(mid));
          })();
        },
        async generateContent({ contents } = {}) {
          return chunk(replyFor(contents));
        },
      };
    }
  }
  genai.GoogleGenAI = FakeGenAI;
}
