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
// can talk over a long greeting. No Supabase, Gemini or Soniox network.
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
db.getTenantProfile = async ({ callSid } = {}) => {
  const { tenant } = parseSid(callSid);
  return tenantProfileFromRow({ ...TENANTS[tenant], hours_schedule: ALWAYS_OPEN, is_active: true });
};
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
