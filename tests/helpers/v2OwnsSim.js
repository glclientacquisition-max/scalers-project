// Fourth preload for the BRAIN_V2_OWNS_CALL e2e (tests/v2OwnsCallE2e.test.js).
// Swaps only in-process edges, before server.js loads:
//   - db: the Done & Dusted fixture as the tenant profile; createAppointment /
//     createServiceRequest / mergeCallSummaryMeta / recordWriteReceipt answer
//     locally and report { ev: 'db', fn, args } to the parent (no Supabase);
//   - v1 counters: guardToolPlan / ensureRequired*, planLookupTurn,
//     resolveLocalReply, planCallerModelTurn and the caller-file speech gate
//     report { ev: 'v1', fn } each time they run. The gate stub would rewrite
//     any line it sees to "EDITED BY V1 GATE", so an edited v2 line is visible;
//   - V2_SIM_THROW (regex): BA v2 live run() throws on a caller line that matches.
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const send = (msg) => {
  try {
    if (process.send) process.send(msg);
  } catch {
    /* parent gone */
  }
};
const DD = require(path.join(ROOT, 'evals/v2/fixtures/tenants/done_and_dusted.json'));

const db = require(path.join(ROOT, 'src/db'));
let seq = 0;
db.getTenantProfile = async () => ({ ...DD, id: 'tenant_sim', businessName: DD.businessName || 'Done and Dusted', agentTools: { ...(DD.agentTools || {}), end_call: true } });
db.getCall = async ({ callSid } = {}) => ({ id: `call_${callSid || 'sim'}`, tenant_id: 'tenant_sim', caller_number: '+254700000001' });
db.createAppointment = async (args) => {
  send({ ev: 'db', fn: 'createAppointment', args });
  return { id: `apt_sim_${++seq}`, service_name: args.serviceName, status: 'requested' };
};
db.createServiceRequest = async (args) => {
  send({ ev: 'db', fn: 'createServiceRequest', args });
  return { id: `sr_sim_${++seq}`, request_type: args.type };
};
db.mergeCallSummaryMeta = async (args) => {
  send({ ev: 'db', fn: 'mergeCallSummaryMeta', args });
  return { ok: true };
};
db.recordWriteReceipt = async (rec) => {
  send({ ev: 'db', fn: 'recordWriteReceipt', args: { phase: rec.phase, tool: rec.tool, idempotencyKey: rec.idempotencyKey } });
  return { ok: true };
};

function count(modPath, names) {
  const mod = require(path.join(ROOT, modPath));
  for (const name of names) {
    const real = mod[name];
    if (typeof real !== 'function') continue;
    mod[name] = function counted(...args) {
      send({ ev: 'v1', fn: name });
      return real.apply(this, args);
    };
  }
}
count('src/conversation/requiredCreateRequest', ['guardToolPlan', 'ensureRequiredCreateRequest']);
count('src/conversation/requiredEscalate', ['ensureRequiredEscalate']);
count('src/conversation/router', ['planLookupTurn']);
count('src/conversation/turnPolicy', ['resolveLocalReply', 'planCallerModelTurn']);
const fileSpeech = require(path.join(ROOT, 'src/speech/callerFileSpeech'));
fileSpeech.gateCallerFileSpeech = (text) => {
  send({ ev: 'v1', fn: 'gateCallerFileSpeech', text });
  return { speak: true, line: 'EDITED BY V1 GATE' };
};

const throwRe = process.env.V2_SIM_THROW ? new RegExp(process.env.V2_SIM_THROW, 'i') : null;
if (throwRe) {
  const liveTurn = require(path.join(ROOT, 'src/conversation/v2/liveTurn'));
  const real = liveTurn.createBrainV2Live;
  liveTurn.createBrainV2Live = (opts) => {
    const live = real(opts);
    return {
      ...live,
      run: async (input) => {
        if (throwRe.test(String(input?.text || ''))) throw new Error('sim: v2 threw mid-turn');
        return live.run(input);
      },
    };
  };
}

// Any other db call answers at once with null (the sim has no Supabase), and is reported.
const STUBBED = new Set(['getTenantProfile', 'getCall', 'createAppointment', 'createServiceRequest', 'mergeCallSummaryMeta', 'recordWriteReceipt']);
for (const [name, fn] of Object.entries(db)) {
  if (typeof fn !== 'function' || STUBBED.has(name)) continue;
  db[name] = async () => {
    send({ ev: 'db_other', fn: name });
    return null;
  };
}
