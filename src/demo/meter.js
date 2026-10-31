'use strict';

// Demo minute and dollar meter. STT, TTS, and model are priced from the
// published rates (Soniox $0.12/h audio, Soniox TTS $0.70/h of speech,
// Gemini $0.75 in / $3.75 out per 1M tokens). A phone call never writes here.
// DEMO_SPEND_PERSIST=on reloads docs/supabase/demo_spend.sql after a restart.
// That file is not applied by this process. A missing table keeps the
// in-memory total for this process only.

const { eatDay } = require('../speech/callMeter');
const { spendPersistOn, dailyCapUsd, monthlyCapUsd } = require('./flags');

const PCM_BYTES_PER_SEC = 32000;
const STT_USD_PER_SEC = 0.12 / 3600;
const TTS_USD_PER_SEC = 0.70 / 3600;
const MODEL_INPUT_USD_PER_TOKEN = 0.75 / 1e6;
const MODEL_OUTPUT_USD_PER_TOKEN = 3.75 / 1e6;
const CHARS_PER_TOKEN = 4;
const DEMO_SID = /^demo_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'session_id,day,month,minutes,stt_seconds,tts_seconds,model_input_tokens,model_output_tokens,cost_usd';

function round6(n) {
  return Math.round((Number(n) || 0) * 1e6) / 1e6;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function tokensFromChars(text) {
  const chars = String(text || '').length;
  if (!chars) return 0;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function createDemoMeter() {
  let sttBytes = 0;
  let ttsBytes = 0;
  let modelInputTokens = 0;
  let modelOutputTokens = 0;

  function sttSeconds() {
    return sttBytes / PCM_BYTES_PER_SEC;
  }

  function ttsSeconds() {
    return ttsBytes / PCM_BYTES_PER_SEC;
  }

  function costUsd() {
    return round6(
      sttSeconds() * STT_USD_PER_SEC
      + ttsSeconds() * TTS_USD_PER_SEC
      + modelInputTokens * MODEL_INPUT_USD_PER_TOKEN
      + modelOutputTokens * MODEL_OUTPUT_USD_PER_TOKEN
    );
  }

  return {
    noteStt(bytes) {
      sttBytes += Math.max(0, num(bytes));
    },
    noteTts(_text, pcmBytes = 0) {
      ttsBytes += Math.max(0, num(pcmBytes));
    },
    noteModel(inputText, outputText) {
      modelInputTokens += tokensFromChars(inputText);
      modelOutputTokens += tokensFromChars(outputText);
    },
    costUsd,
    summary(durationMs) {
      return {
        minutes: round3(Math.max(0, num(durationMs)) / 60000),
        sttSeconds: round3(sttSeconds()),
        ttsSeconds: round3(ttsSeconds()),
        modelInputTokens,
        modelOutputTokens,
        costUsd: costUsd(),
      };
    },
  };
}

function publicRow(summary, at) {
  const day = eatDay(at);
  return {
    session_id: String(summary.sessionId),
    day,
    month: day.slice(0, 7),
    minutes: round3(summary.minutes),
    stt_seconds: round3(summary.sttSeconds),
    tts_seconds: round3(summary.ttsSeconds),
    model_input_tokens: Math.max(0, Math.round(num(summary.modelInputTokens))),
    model_output_tokens: Math.max(0, Math.round(num(summary.modelOutputTokens))),
    cost_usd: round6(summary.costUsd),
  };
}

function rowFromStore(row) {
  const sessionId = String(row && row.session_id || '');
  if (!DEMO_SID.test(sessionId)) return null;
  const day = String(row.day || '');
  return {
    session_id: sessionId,
    day,
    month: String(row.month || day.slice(0, 7)),
    minutes: round3(num(row.minutes)),
    stt_seconds: round3(num(row.stt_seconds)),
    tts_seconds: round3(num(row.tts_seconds)),
    model_input_tokens: Math.max(0, Math.round(num(row.model_input_tokens))),
    model_output_tokens: Math.max(0, Math.round(num(row.model_output_tokens))),
    cost_usd: round6(num(row.cost_usd)),
  };
}

function createMemorySpendStore() {
  const rows = new Map();
  return {
    kind: 'memory',
    async load() {
      return [...rows.values()].map((row) => ({ ...row }));
    },
    async save(row) {
      rows.set(row.session_id, { ...row });
    },
  };
}

function createSupabaseSpendStore(client) {
  function db() {
    if (client) return client;
    return require('../lib/supabaseClient').supabase;
  }
  return {
    kind: 'supabase',
    async load() {
      const { data, error } = await db().from('demo_spend').select(COLUMNS);
      if (error) throw new Error('demo_spend');
      return data || [];
    },
    async save(row) {
      const { error } = await db().from('demo_spend').upsert({ ...row }, { onConflict: 'session_id' });
      if (error) throw new Error('demo_spend');
    },
  };
}

function createDemoLedger(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now || (() => Date.now());
  const store = opts.store || createMemorySpendStore();
  const log = opts.log || (() => {});
  let rows = [];
  let loaded = false;
  let loading = null;
  let warned = false;
  const open = new Map();

  function fail(kind) {
    if (warned) return;
    warned = true;
    try { log(`demo_spend_${kind} ${JSON.stringify({ reason: 'store' })}`); } catch { /* ignore */ }
  }

  function totals(at = now()) {
    const day = eatDay(at);
    const month = day.slice(0, 7);
    let dayUsd = 0;
    let monthUsd = 0;
    let dayMinutes = 0;
    let monthMinutes = 0;
    let daySessions = 0;
    let monthSessions = 0;
    for (const row of rows) {
      const usd = num(row.cost_usd);
      const mins = num(row.minutes);
      if (row.month === month) {
        monthUsd += usd;
        monthMinutes += mins;
        monthSessions += 1;
      }
      if (row.day === day) {
        dayUsd += usd;
        dayMinutes += mins;
        daySessions += 1;
      }
    }
    for (const item of open.values()) {
      dayUsd += num(item.costUsd());
      monthUsd += num(item.costUsd());
      dayMinutes += num(item.minutes());
      monthMinutes += num(item.minutes());
    }
    daySessions += open.size;
    monthSessions += open.size;
    dayUsd = round6(dayUsd);
    monthUsd = round6(monthUsd);
    const dailyCap = dailyCapUsd(env);
    const monthlyCap = monthlyCapUsd(env);
    return {
      day,
      month,
      dayUsd,
      monthUsd,
      dayMinutes: round3(dayMinutes),
      monthMinutes: round3(monthMinutes),
      daySessions,
      monthSessions,
      capped: dayUsd >= dailyCap || monthUsd >= monthlyCap,
      dailyCap,
      monthlyCap,
      loaded,
    };
  }

  function touch() {
    if (!totals().capped) return;
    for (const item of open.values()) {
      if (item.ended) continue;
      item.ended = true;
      try { item.onCap(); } catch { /* one session must not block the others */ }
    }
  }

  async function ready() {
    if (loaded) return totals();
    if (!loading) {
      loading = Promise.resolve()
        .then(() => store.load())
        .then((list) => {
          rows = [];
          for (const row of Array.isArray(list) ? list : []) {
            const clean = rowFromStore(row);
            if (clean) rows.push(clean);
          }
        })
        .catch(() => {
          rows = [];
          fail('load_failed');
        })
        .finally(() => {
          loaded = true;
        });
    }
    await loading;
    return totals();
  }

  function attach(sessionId, reader) {
    if (!DEMO_SID.test(String(sessionId || ''))) return false;
    open.set(sessionId, {
      costUsd: () => num(reader && reader.costUsd && reader.costUsd()),
      minutes: () => num(reader && reader.minutes && reader.minutes()),
      onCap: reader && typeof reader.onCap === 'function' ? reader.onCap : () => {},
      ended: false,
    });
    return true;
  }

  async function record(summary, at = now()) {
    const sessionId = String(summary && summary.sessionId || '');
    if (!DEMO_SID.test(sessionId)) return false;
    await ready();
    open.delete(sessionId);
    const row = publicRow({ ...summary, sessionId }, at);
    const idx = rows.findIndex((item) => item.session_id === sessionId);
    if (idx >= 0) rows[idx] = row;
    else rows.push(row);
    if (store && typeof store.save === 'function') {
      try { await store.save({ ...row }); }
      catch { fail('save_failed'); }
    }
    touch();
    return true;
  }

  function blocked() {
    return totals().capped;
  }

  return { ready, totals, blocked, attach, record, touch };
}

function healthCounts(snapshot) {
  const row = snapshot || {};
  return {
    daySessions: num(row.daySessions),
    monthSessions: num(row.monthSessions),
    dayMinutes: round3(row.dayMinutes),
    monthMinutes: round3(row.monthMinutes),
    dayUsd: round6(row.dayUsd),
    monthUsd: round6(row.monthUsd),
    capped: row.capped === true,
  };
}

let singleton = null;

function storeForEnv(env = process.env) {
  if (
    spendPersistOn(env)
    && String(env.SUPABASE_URL || '').trim()
    && String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  ) {
    return createSupabaseSpendStore(null);
  }
  return createMemorySpendStore();
}

function getDemoLedger() {
  if (!singleton) {
    singleton = createDemoLedger({ store: storeForEnv(process.env), env: process.env });
    singleton.ready().catch(() => {});
  }
  return singleton;
}

function demoHealthCounts() {
  try {
    return healthCounts(getDemoLedger().totals());
  } catch {
    return healthCounts({ capped: false });
  }
}

module.exports = {
  PCM_BYTES_PER_SEC,
  tokensFromChars,
  createDemoMeter,
  createMemorySpendStore,
  createSupabaseSpendStore,
  createDemoLedger,
  healthCounts,
  getDemoLedger,
  demoHealthCounts,
};
