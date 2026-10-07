/* eslint-disable @typescript-eslint/no-require-imports */
// Turn voice_turn_traces rows into the Quality JSON Desk renders.
// Rollups read call rows only. Turn score and checks stay as Voice stored them.

const { releaseKeyFromCall, rollupBusiness, rollupBusinesses, listReleaseDeltas, topFailureFromChecks } = require("./rollup");

const RELEASE_GAP =
  "Release buckets use release.gitSha from the call row when Voice stored it. Branch and label ride along. An empty git SHA falls back to the Africa/Nairobi calendar day.";

const DAY_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseWindowDays(raw) {
  if (raw == null || raw === "") return 7;
  if (!/^\d+$/.test(String(raw))) return null;
  const days = Number(raw);
  if (days < 1 || days > 30) return null;
  return days;
}

function parseCallLimit(raw) {
  if (raw == null || raw === "") return 30;
  if (!/^\d+$/.test(String(raw))) return null;
  const limit = Number(raw);
  if (limit < 1 || limit > 100) return null;
  return limit;
}

function parseBusinessId(raw) {
  const id = String(raw || "").trim();
  if (!UUID_RE.test(id)) return null;
  return id;
}

function parseCallId(raw) {
  const id = decodeURIComponent(String(raw || "")).trim();
  if (!id || id.length > 128 || /[\s/\\]/.test(id)) return null;
  return id;
}

function isMissingTraceTable(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  const message = String(error.message || "");
  return /voice_turn_traces|schema cache|does not exist/i.test(message) && !isMissingScoreColumn(error);
}

function isMissingScoreColumn(error) {
  const message = String(error?.message || "");
  return /column .+ does not exist|schema cache/i.test(message) && /score|checks|diagnosis|\brelease\b/i.test(message);
}

function interpretTraceQuery(result) {
  if (result?.error) {
    if (isMissingTraceTable(result.error)) return { ready: false, rows: [] };
    throw new Error(result.error.message || "trace read failed");
  }
  return { ready: true, rows: result?.data || [] };
}

function asObject(value) {
  if (!value || typeof value === "number") return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function finiteScore(value) {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function checksOf(...values) {
  for (const value of values) {
    const obj = asObject(value);
    if (obj && !Array.isArray(obj)) return obj;
  }
  return null;
}

function textOf(...values) {
  for (const value of values) {
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function stage(turn, name) {
  const rows = (turn?.stages || []).filter((row) => row.stage === name);
  return rows[rows.length - 1] || null;
}

function callFromRow(row) {
  if (row?.record_kind !== "call") return null;
  const callId = String(row.call_id || "").trim();
  if (!callId) return null;
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const score = finiteScore(row.score) ?? finiteScore(payload.score);
  const atIso = payload.startedAt || payload.endedAt || row.created_at || null;
  const at = Date.parse(atIso);
  const columnRelease = asObject(row.release);
  return {
    callId,
    tenantId: row.tenant_id || payload.tenantId || null,
    at: Number.isFinite(at) ? at : 0,
    atIso,
    turnCount: payload.turnCount ?? null,
    release: releaseKeyFromCall(columnRelease ? { ...payload, release: columnRelease } : payload, atIso),
    score,
    checks: checksOf(row.checks, payload.checks) || {},
    diagnosis: textOf(row.diagnosis, payload.diagnosis),
    scoreSource: score != null ? "stored" : null,
  };
}

function callsFromRows(rows) {
  const byCall = new Map();
  for (const row of rows || []) {
    const call = callFromRow(row);
    if (!call) continue;
    if (!byCall.has(call.callId)) byCall.set(call.callId, call);
  }
  return [...byCall.values()];
}

function scoredCalls(calls) {
  return calls.filter((call) => call.score != null);
}

function callListItem(call) {
  return {
    callId: call.callId,
    at: call.atIso,
    score: call.score,
    checks: call.checks,
    diagnosis: call.diagnosis || null,
    scoreSource: call.scoreSource,
    turnCount: call.turnCount,
    topFailure: topFailureFromChecks(call.checks),
    release: call.release,
  };
}

function listBusinessQuality({ rows, names, now, windowDays, truncated }) {
  const scored = scoredCalls(callsFromRows(rows));
  const businesses = rollupBusinesses(scored, now, windowDays * DAY_MS).map((business) => ({
    ...business,
    businessName: names?.[business.businessId] || null,
  }));
  return {
    ok: true,
    ready: true,
    windowDays,
    truncated: Boolean(truncated),
    release: { gap: RELEASE_GAP },
    businesses,
  };
}

function getBusinessQuality({ rows, businessId, businessName, limit, now }) {
  const mine = callsFromRows(rows).filter((call) => call.tenantId === businessId);
  const summary = rollupBusiness(scoredCalls(mine), now, 7 * DAY_MS);
  const calls = mine
    .slice()
    .sort((a, b) => b.at - a.at)
    .slice(0, limit)
    .map(callListItem);
  return {
    ok: true,
    ready: true,
    ...summary,
    businessId,
    businessName: businessName || null,
    calls,
  };
}

function turnFromRow(row) {
  const payload = row?.payload && typeof row.payload === "object" ? row.payload : {};
  const latency = stage(payload, "latency");
  const outcome = stage(payload, "outcome");
  const tts = stage(payload, "tts");
  return {
    turnIndex: payload.turnIndex ?? row.turn_index ?? null,
    at: payload.at || row.created_at || null,
    caller: {
      text: payload.caller?.text || "",
      language: payload.caller?.language || null,
    },
    spoken: typeof tts?.text === "string" ? tts.text : "",
    outcome: outcome?.value || null,
    score: finiteScore(row.score) ?? finiteScore(payload.score),
    checks: checksOf(row.checks, payload.checks) || {},
    latency: {
      callerStopToModelFirstTokenMs: latency?.callerStopToModelFirstTokenMs ?? null,
      callerStopToFirstTtsPcmMs: latency?.callerStopToFirstTtsPcmMs ?? null,
    },
    stages: Array.isArray(payload.stages) ? payload.stages : [],
  };
}

function getCallTrace({ rows }) {
  const list = rows || [];
  if (!list.length) return null;
  const callRow = list.find((row) => row.record_kind === "call") || null;
  const turnRows = list
    .filter((row) => row.record_kind === "turn")
    .slice()
    .sort((a, b) => Number(a.turn_index ?? 0) - Number(b.turn_index ?? 0));
  const payload = callRow?.payload && typeof callRow.payload === "object" ? callRow.payload : {};
  const score = callRow ? finiteScore(callRow.score) ?? finiteScore(payload.score) : null;
  const checks = callRow ? checksOf(callRow.checks, payload.checks) || {} : {};
  const atIso = payload.startedAt || callRow?.created_at || turnRows[0]?.created_at || null;
  const columnRelease = asObject(callRow?.release);
  return {
    ok: true,
    ready: true,
    call: {
      callId: payload.callId || callRow?.call_id || turnRows[0]?.call_id || null,
      tenantId: callRow?.tenant_id || payload.tenantId || turnRows[0]?.tenant_id || null,
      startedAt: payload.startedAt || null,
      endedAt: payload.endedAt || null,
      turnCount: payload.turnCount ?? turnRows.length,
      voiceId: payload.voiceId || null,
      sttModel: payload.sttModel || null,
      ttsModel: payload.ttsModel || null,
      pii: payload.pii || callRow?.pii || "transcript",
      score,
      checks,
      diagnosis: callRow ? textOf(callRow.diagnosis, payload.diagnosis) : null,
      scoreSource: score != null ? "stored" : null,
      topFailure: topFailureFromChecks(checks),
      release: releaseKeyFromCall(columnRelease ? { ...payload, release: columnRelease } : payload, atIso),
      stages: Array.isArray(payload.stages) ? payload.stages : [],
    },
    turns: turnRows.map(turnFromRow),
  };
}

function listReleaseDeltasFromRows({ rows, businessId }) {
  let calls = scoredCalls(callsFromRows(rows));
  if (businessId) calls = calls.filter((call) => call.tenantId === businessId);
  return listReleaseDeltas(calls);
}

function emptyHome(windowDays) {
  return {
    ok: true,
    ready: false,
    windowDays,
    truncated: false,
    release: { gap: RELEASE_GAP },
    businesses: [],
  };
}

function emptyBusiness(businessId) {
  return {
    ok: true,
    ready: false,
    businessId,
    businessName: null,
    currentScore: null,
    priorScore: null,
    trend: null,
    trendDirection: "unknown",
    dropping: false,
    droppingReason: null,
    topFailure: null,
    callCount: 0,
    priorCallCount: 0,
    releases: [],
    calls: [],
  };
}

function emptyCall() {
  return { ok: true, ready: false, call: null, turns: [] };
}

function emptyReleases(windowDays) {
  return {
    ok: true,
    ready: false,
    windowDays,
    truncated: false,
    release: { gap: RELEASE_GAP },
    releases: [],
  };
}

module.exports = {
  RELEASE_GAP,
  DAY_MS,
  parseWindowDays,
  parseCallLimit,
  parseBusinessId,
  parseCallId,
  isMissingTraceTable,
  isMissingScoreColumn,
  interpretTraceQuery,
  callsFromRows,
  listBusinessQuality,
  getBusinessQuality,
  getCallTrace,
  listReleaseDeltasFromRows,
  emptyHome,
  emptyBusiness,
  emptyCall,
  emptyReleases,
};
