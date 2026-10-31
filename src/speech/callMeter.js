// Per-call Soniox meter + daily rolling total (VOICE_CALL_METER=on).
// Logged at call end; the daily total (EAT day) is on /healthz.

const PCM_BYTES_PER_SEC = 32000; // 16 kHz mono s16le

function callMeterOn(env = process.env) {
  return String(env.VOICE_CALL_METER ?? '').trim() === 'on';
}

function eatDay(ms = Date.now()) {
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function emptyTotals(day) {
  return {
    day, calls: 0, sttBytesIn: 0, sttBytesSent: 0, sttSecondsSent: 0, sttSecondsGated: 0,
    keepalives: 0, ttsChars: 0, ttsRenderedSeconds: 0, cacheHits: 0, cacheMisses: 0,
  };
}

let daily = emptyTotals(eatDay());
// demo_* sessions only. A phone call never lands here, and a demo session
// never lands in `daily`. This bucket is the live process view. The restart
// safe dollar total lives in src/demo/meter.js.
let demoDaily = emptyTotals(eatDay());

function isDemoSid(callSid) {
  return String(callSid || '').startsWith('demo_');
}

function rolled(bucket, nowMs) {
  const day = eatDay(nowMs);
  return bucket.day === day ? bucket : emptyTotals(day);
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function createCallMeter(opts = {}) {
  const demo = isDemoSid(opts.callSid);
  const m = { ttsChars: 0, ttsRenderedBytes: 0, cacheHits: 0, cacheMisses: 0 };
  return {
    tts(text, pcmBytes = 0) {
      m.ttsChars += String(text || '').length;
      m.ttsRenderedBytes += Number(pcmBytes) || 0;
    },
    cache(hit) {
      if (hit) m.cacheHits += 1;
      else m.cacheMisses += 1;
    },
    /** @param {{ bytesIn:number, bytesSent:number, keepalives:number }} gateStats */
    finish(gateStats = {}, nowMs = Date.now()) {
      const bytesIn = gateStats.bytesIn || 0;
      const bytesSent = gateStats.bytesSent || 0;
      const summary = {
        sttBytesIn: bytesIn,
        sttBytesSent: bytesSent,
        sttSecondsSent: round(bytesSent / PCM_BYTES_PER_SEC),
        sttSecondsGated: round((bytesIn - bytesSent) / PCM_BYTES_PER_SEC),
        keepalives: gateStats.keepalives || 0,
        ttsChars: m.ttsChars,
        ttsRenderedSeconds: round(m.ttsRenderedBytes / PCM_BYTES_PER_SEC),
        cacheHits: m.cacheHits,
        cacheMisses: m.cacheMisses,
      };
      if (demo) {
        demoDaily = rolled(demoDaily, nowMs);
        demoDaily.calls += 1;
        for (const k of Object.keys(summary)) demoDaily[k] = round((demoDaily[k] || 0) + summary[k]);
      } else {
        const day = eatDay(nowMs);
        if (daily.day !== day) daily = emptyTotals(day);
        daily.calls += 1;
        for (const k of Object.keys(summary)) daily[k] = round((daily[k] || 0) + summary[k]);
      }
      return summary;
    },
  };
}

function dailyMeterTotals(nowMs = Date.now()) {
  if (daily.day !== eatDay(nowMs)) daily = emptyTotals(eatDay(nowMs));
  return { ...daily };
}

function demoMeterTotals(nowMs = Date.now()) {
  demoDaily = rolled(demoDaily, nowMs);
  return { ...demoDaily };
}

function resetDailyMeter() {
  daily = emptyTotals(eatDay());
  demoDaily = emptyTotals(eatDay());
}

module.exports = {
  callMeterOn, createCallMeter, dailyMeterTotals, demoMeterTotals, resetDailyMeter, eatDay, isDemoSid,
};
