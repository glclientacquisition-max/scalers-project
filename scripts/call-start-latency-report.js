#!/usr/bin/env node
'use strict';

// VOICE_QUERY_BATCHING before/after report (N+1 audit #1): p50 / p95 / max of
//   connect_to_greeting_pcm_ms  (media WS connect -> first greeting PCM)
//   call_start_profile_ms       (tenant profile + caller card load)
// split by batched=0 (flag off) / batched=1 (flag on) and by cached greeting.
// Lines are joined by call sid, so one call counts once.
//
// Input: voice log exports, as files or stdin. It reads only what you hand it;
// it calls no service and needs no credentials.
//   node scripts/call-start-latency-report.js staging-before.log staging-after.log
//   cat staging.log | node scripts/call-start-latency-report.js -
//   node scripts/call-start-latency-report.js staging.log --json
//
// Log lines (server.js / src/speech/voiceTiming.js):
//   [voice-timing][<sid>] call_start_profile_ms=212 batched=1 card=1
//   [voice-timing][<sid>] connect_to_greeting_pcm_ms=540 cached=1

const fs = require('fs');

const PROFILE_RE = /\[voice-timing\]\[([^\]]+)\] call_start_profile_ms=(\d+) batched=([01])(?: card=([01]))?/;
const GREETING_RE = /\[voice-timing\]\[([^\]]+)\] connect_to_greeting_pcm_ms=(\d+) cached=([01])/;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function summarize(values) {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), max: s.length ? s[s.length - 1] : null };
}

function parseLines(text) {
  /** @type {Map<string, { profileMs?: number, batched?: string, card?: string, greetingMs?: number, cached?: string }>} */
  const calls = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    let m = PROFILE_RE.exec(line);
    if (m) {
      const c = calls.get(m[1]) || {};
      c.profileMs = Number(m[2]);
      c.batched = m[3];
      if (m[4] != null) c.card = m[4];
      calls.set(m[1], c);
      continue;
    }
    m = GREETING_RE.exec(line);
    if (m) {
      const c = calls.get(m[1]) || {};
      if (c.greetingMs == null) {
        c.greetingMs = Number(m[2]);
        c.cached = m[3];
      }
      calls.set(m[1], c);
    }
  }
  return calls;
}

function report(calls) {
  const groups = {};
  for (const [sid, c] of calls) {
    const key = `batched=${c.batched ?? '?'}`;
    const g = (groups[key] = groups[key] || { sids: [], profile: [], greeting: [], greetingCached: [], greetingLive: [] });
    g.sids.push(sid);
    if (c.profileMs != null) g.profile.push(c.profileMs);
    if (c.greetingMs != null) {
      g.greeting.push(c.greetingMs);
      (c.cached === '1' ? g.greetingCached : g.greetingLive).push(c.greetingMs);
    }
  }
  const out = {};
  for (const [key, g] of Object.entries(groups)) {
    out[key] = {
      calls: g.sids.length,
      call_start_profile_ms: summarize(g.profile),
      connect_to_greeting_pcm_ms: summarize(g.greeting),
      connect_to_greeting_pcm_ms_cached: summarize(g.greetingCached),
      connect_to_greeting_pcm_ms_live_tts: summarize(g.greetingLive),
      target_600ms_met_p50: (() => {
        const s = summarize(g.greeting);
        return s.p50 == null ? null : s.p50 <= 600;
      })(),
    };
  }
  return out;
}

function main(argv) {
  const json = argv.includes('--json');
  const files = argv.filter((a) => a !== '--json');
  const text = (files.length ? files : ['-'])
    .map((f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8')))
    .join('\n');
  const out = report(parseLines(text));
  if (json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
    return;
  }
  for (const [key, r] of Object.entries(out)) {
    const fmt = (s) => `n=${s.n} p50=${s.p50 ?? '-'} p95=${s.p95 ?? '-'} max=${s.max ?? '-'}`;
    console.log(`${key} calls=${r.calls}`);
    console.log(`  call_start_profile_ms        ${fmt(r.call_start_profile_ms)}`);
    console.log(`  connect_to_greeting_pcm_ms   ${fmt(r.connect_to_greeting_pcm_ms)}  (<=600 p50: ${r.target_600ms_met_p50})`);
    console.log(`    cached greeting            ${fmt(r.connect_to_greeting_pcm_ms_cached)}`);
    console.log(`    live TTS greeting          ${fmt(r.connect_to_greeting_pcm_ms_live_tts)}`);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { parseLines, report, summarize, percentile };
