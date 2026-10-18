#!/usr/bin/env node
// Time POST / (SautiKit VoiceProxy Ringing) to Stream XML with Supabase
// stubbed at a fixed per-query latency. Prod HD_d3900cbf2b2d measured 2051 ms
// for ~6 sequential reads (~340 ms each).
//
//   node scripts/bench-inbound-webhook.js [--rtt 340] [--calls 5]
//   VOICE_FAST_INBOUND=0 node scripts/bench-inbound-webhook.js   # legacy path
//
// No network: Supabase, Soniox, and SautiKit keys are cleared.

const http = require('http');
const path = require('path');

const args = process.argv.slice(2);
const argVal = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const RTT = argVal('--rtt', 340);
const CALLS = argVal('--calls', 5);

for (const k of Object.keys(process.env)) {
  if (/^(SONIOX|SAUTIKIT|TEXTSMS|RESEND|GEMINI|WHATSAPP)_/.test(k)) delete process.env[k];
}
delete process.env.TENANT_ID;
process.env.SUPABASE_URL = 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'bench';
process.env.PORT = '0';
process.env.NODE_ENV = 'test';

const DID = '+254700000001';
const TENANT = { id: 'tenant-bench', sautikit_virtual_number: DID, is_active: true, minutes_included: 100, seconds_used: 10, on_demand_usage_enabled: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let queries = 0;
const q = async (n = 1) => {
  for (let i = 0; i < n; i += 1) {
    queries += 1;
    await sleep(RTT);
  }
};

const db = require(path.join(__dirname, '..', 'src', 'db'));
const rows = new Map();
db.listActiveTenantDids = async () => { await q(1); return [DID]; };
db.packageInboundOpen = async () => { await q(2); return { open: true, reason: 'included' }; };
db.upsertCall = async ({ callSid, tenantId }) => { await q(tenantId ? 2 : 3); const row = { id: callSid, tenant_id: TENANT.id }; rows.set(callSid, row); return row; };
db.listInboundTenantRows = async () => { await q(1); return { rows: [TENANT], packageColumns: true }; };
db.getCall = async (sid) => { await q(1); return rows.get(sid) || null; };
db.updateCallStatus = async () => null;
db.getTenantProfile = async () => ({ id: TENANT.id, businessName: 'Bench Shop' });

const origLog = console.log;
const lines = [];
console.log = (...a) => { const t = a.map(String).join(' '); lines.push(t); if (process.env.BENCH_VERBOSE) origLog(...a); };
console.warn = console.log;
console.error = console.log;

require(path.join(__dirname, '..', 'server.js'));

function post(port, body) {
  const payload = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.request({ host: '127.0.0.1', port, path: '/', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(payload), 'user-agent': 'Sautikit-VoiceProxy' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

(async () => {
  await sleep(1500); // boot (+ directory warm on the fast path)
  const net = require('net');
  // find our listening port
  const handles = process._getActiveHandles().filter((h) => h instanceof net.Server && h.address());
  const port = handles[0].address().port;
  const results = [];
  for (let i = 0; i < CALLS; i += 1) {
    queries = 0;
    const r = await post(port, { callSid: `bench_${Date.now()}_${i}`, callerNumber: '+254711111111', destinationNumber: DID, callSessionState: 'Ringing' });
    results.push({ ms: Math.round(r.ms), queries, stream: /<Stream/.test(r.body) });
  }
  const mode = String(process.env.VOICE_FAST_INBOUND ?? 'on');
  origLog(JSON.stringify({ mode, rttMs: RTT, results, medianMs: results.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(results.length / 2)] }));
  process.exit(0);
})();
