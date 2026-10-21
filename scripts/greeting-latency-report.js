#!/usr/bin/env node
'use strict';

// VOICE_OPENING_V2 greeting latency report: p50 / p95 of greeting.first_pcm_ms
// (stream start -> first greeting PCM), overall and split by prefetch
// (hit | inflight | miss | failed | off) and cached greeting PCM.
//
// Input: staging log exports and/or voice trace JSONL, as files or stdin. It
// reads what you hand it; it calls no service and needs no credentials.
//
//   railway logs --service <voice> > staging.log      # however logs are exported
//   node scripts/greeting-latency-report.js staging.log
//   node scripts/greeting-latency-report.js traces.jsonl --json
//   cat staging.log | node scripts/greeting-latency-report.js -
//
// Log line:  [voice-timing][<sid>] greeting.first_pcm_ms=412 from=stream_start prefetch=hit cached=1 ...
// Trace:     any JSON object (any depth) with stage "opening" and firstPcmMs.
// One sample per call stream (callSid + stream_seq when known), so a log and
// a trace of the same stream count once.

const fs = require('fs');

const LOG_RE = /\[voice-timing\]\[([^\]]*)\] greeting\.first_pcm_ms=(\d+)(.*)$/;
const field = (rest, k) => {
  const m = new RegExp(`(?:^|\\s)${k}=(\\S+)`).exec(rest);
  return m ? m[1] : null;
};

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function summarize(values) {
  const s = values.slice().sort((a, b) => a - b);
  return { n: s.length, p50: percentile(s, 50), p95: percentile(s, 95), max: s.length ? s[s.length - 1] : null };
}

function walkOpeningStages(obj, out, ctx = {}) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const v of obj) walkOpeningStages(v, out, ctx);
    return;
  }
  const here = { callSid: obj.callSid || obj.call_sid || ctx.callSid || null };
  if (obj.stage === 'opening' && Number.isFinite(Number(obj.firstPcmMs))) {
    out.push({
      callSid: here.callSid,
      streamSeq: obj.streamSeq ?? null,
      ms: Number(obj.firstPcmMs),
      prefetch: obj.prefetch || 'unknown',
      cached: obj.cached === true || obj.cached === 1 || obj.cached === '1' ? 1 : 0,
    });
  }
  for (const v of Object.values(obj)) if (v && typeof v === 'object') walkOpeningStages(v, out, here);
}

/** Parse log/trace text into samples. */
function parseSamples(text) {
  const samples = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = LOG_RE.exec(line);
    if (m) {
      samples.push({
        callSid: m[1] || null,
        streamSeq: null,
        ms: Number(m[2]),
        prefetch: field(m[3], 'prefetch') || 'unknown',
        cached: field(m[3], 'cached') === '1' ? 1 : 0,
        source: 'log',
      });
      continue;
    }
    const brace = line.indexOf('{');
    if (brace < 0 || !line.includes('opening')) continue;
    try {
      const found = [];
      walkOpeningStages(JSON.parse(line.slice(brace)), found);
      for (const f of found) samples.push({ ...f, source: 'trace' });
    } catch {
      /* not JSON */
    }
  }
  // One per stream: a log line and its trace record carry the same callSid
  // (the trace also the stream_seq); keep the first per callSid + ms.
  const seen = new Set();
  return samples.filter((s) => {
    if (!s.callSid) return true;
    const key = `${s.callSid}|${s.ms}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function report(samples) {
  const by = (keyFn) => {
    const groups = {};
    for (const s of samples) (groups[keyFn(s)] ||= []).push(s.ms);
    return Object.fromEntries(Object.entries(groups).sort().map(([k, v]) => [k, summarize(v)]));
  };
  return {
    all: summarize(samples.map((s) => s.ms)),
    byPrefetch: by((s) => s.prefetch),
    byCached: by((s) => (s.cached ? 'cached' : 'live_tts')),
    byPrefetchCached: by((s) => `${s.prefetch}/${s.cached ? 'cached' : 'live_tts'}`),
    under600: samples.length ? samples.filter((s) => s.ms < 600).length / samples.length : null,
  };
}

function formatReport(r) {
  const row = (label, x) =>
    `${label.padEnd(22)} n=${String(x.n).padStart(4)}  p50=${String(x.p50 ?? '-').padStart(5)} ms  p95=${String(x.p95 ?? '-').padStart(5)} ms  max=${String(x.max ?? '-').padStart(5)} ms`;
  const lines = ['greeting.first_pcm_ms (stream start -> first greeting PCM)', row('all', r.all)];
  if (r.under600 != null) lines.push(`${'under 600 ms'.padEnd(22)} ${(r.under600 * 100).toFixed(1)}%`);
  lines.push('', 'by prefetch:');
  for (const [k, v] of Object.entries(r.byPrefetch)) lines.push(row(`  ${k}`, v));
  lines.push('', 'by greeting audio:');
  for (const [k, v] of Object.entries(r.byCached)) lines.push(row(`  ${k}`, v));
  lines.push('', 'by prefetch / audio:');
  for (const [k, v] of Object.entries(r.byPrefetchCached)) lines.push(row(`  ${k}`, v));
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const files = args.filter((a) => a !== '--json');
  const text = files.length ? files.map((f) => fs.readFileSync(f === '-' ? 0 : f, 'utf8')).join('\n') : fs.readFileSync(0, 'utf8');
  const samples = parseSamples(text);
  if (!samples.length) {
    console.error('no greeting.first_pcm_ms samples found (VOICE_OPENING_V2 on? logs from the voice service?)');
    process.exitCode = 1;
    return;
  }
  const r = report(samples);
  console.log(json ? JSON.stringify(r, null, 2) : formatReport(r));
}

if (require.main === module) main(process.argv);

module.exports = { parseSamples, report, formatReport, percentile, summarize };
