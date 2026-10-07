/* eslint-disable @typescript-eslint/no-require-imports */
// Turn voice_turn_traces rows into the Quality JSON Desk renders.
// A stored call score wins over a rescore. Payloads stay as the writer stored them.

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

function scoreTraceRows(rows, scoreTurns, diagnoseCall) {
  const byCall = new Map();
  for (const row of rows || []) {
    const callId = String(row?.call_id || "").trim();
    if (!callId) continue;
    let bucket = byCall.get(callId);
    if (!bucket) {
      bucket = { callId, tenantId: row.tenant_id || null, call: null, turns: [] };
      byCall.set(callId, bucket);
    }
    if (row.tenant_id) bucket.tenantId = row.tenant_id;
    if (row.record_kind === "call") bucket.call = row;
    else if (row.record_kind === "turn") bucket.turns.push(row);
  }

  const calls = [];
  for (const bucket of byCall.values()) {
    const turnPayloads = bucket.turns
      .slice()
      .sort((a, b) => Number(a.turn_index ?? 0) - Number(b.turn_index ?? 0))
      .map((row) => row.payload)
      .filter(Boolean);
    const payload = bucket.call?.payload && typeof bucket.call.payload === "object" ? bucket.call.payload : {};
    const storedScore = finiteScore(bucket.call?.score) ?? finiteScore(payload.score);
    const atIso = payload.startedAt || payload.endedAt || bucket.call?.created_at || bucket.turns[0]?.created_at || null;
    const at = Date.parse(atIso);
    const columnRelease = asObject(bucket.call?.release);
    const releasePayload = columnRelease ? { ...payload, release: columnRelease } : payload;
    const base = {
      callId: bucket.callId,
      tenantId: bucket.tenantId || payload.tenantId || null,
      at: Number.isFinite(at) ? at : 0,
      atIso,
      turnCount: payload.turnCount ?? turnPayloads.length,
      release: releaseKeyFromCall(releasePayload, atIso),
    };

    if (storedScore != null) {
      calls.push({
        ...base,
        score: storedScore,
        checks: checksOf(bucket.call?.checks, payload.checks) || {},
        nameAsks: 0,
        diagnosis: textOf(bucket.call?.diagnosis, payload.diagnosis),
        scoreSource: "stored",
      });
      continue;
    }

    if (!turnPayloads.length) continue;
    const scored = scoreTurns(turnPayloads);
    if (scored?.score == null) continue;
    calls.push({
      ...base,
      score: scored.score,
      checks: scored.checks || {},
      nameAsks: scored.nameAsks || 0,
      diagnosis: typeof diagnoseCall === "function" ? diagnoseCall(scored) : null,
      scoreSource: "scored",
    });
  }
  return calls;
}

function callListItem(call) {
  return {
    callId: call.callId,
    at: call.atIso,
    score: call.score,
    checks: call.checks,
    diagnosis: call.diagnosis || null,
    scoreSource: call.scoreSource,
    nameAsks: call.nameAsks,
    turnCount: call.turnCount,
    topFailure: topFailureFromChecks(call.checks),
    release: call.release,
  };
}

function listBusinessQuality({ rows, names, now, windowDays, truncated, scoreTurns, diagnoseCall }) {
  const scored = scoreTraceRows(rows, scoreTurns, diagnoseCall);
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

function getBusinessQuality({ rows, businessId, businessName, limit, now, scoreTurns, diagnoseCall }) {
  const mine = scoreTraceRows(rows, scoreTurns, diagnoseCall).filter((call) => call.tenantId === businessId);
  const summary = rollupBusiness(mine, now, 7 * DAY_MS);
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

function getCallTrace({ rows, scoreTurns, diagnoseCall }) {
  const list = rows || [];
  if (!list.length) return null;
  const callRow = list.find((row) => row.record_kind === "call") || null;
  const turnRows = list
    .filter((row) => row.record_kind === "turn")
    .slice()
    .sort((a, b) => Number(a.turn_index ?? 0) - Number(b.turn_index ?? 0));
  const turns = turnRows.map((row) => row.payload).filter(Boolean);
  const scored = turns.length ? scoreTurns(turns) : null;
  const byIndex = new Map((scored?.turns || []).map((turn) => [turn.turnIndex, turn]));
  const payload = callRow?.payload && typeof callRow.payload === "object" ? callRow.payload : {};
  const storedScore = finiteScore(callRow?.score) ?? finiteScore(payload.score);
  const atIso = payload.startedAt || callRow?.created_at || turnRows[0]?.created_at || null;
  const columnRelease = asObject(callRow?.release);
  const score = storedScore != null ? storedScore : scored?.score ?? null;
  const checks = storedScore != null ? checksOf(callRow?.checks, payload.checks) || {} : scored?.checks || {};
  return {
    ok: true,
    ready: true,
    call: {
      callId: payload.callId || callRow?.call_id || turnRows[0]?.call_id || null,
      tenantId: callRow?.tenant_id || payload.tenantId || turnRows[0]?.tenant_id || null,
      startedAt: payload.startedAt || null,
      endedAt: payload.endedAt || null,
      turnCount: payload.turnCount ?? turns.length,
      voiceId: payload.voiceId || null,
      sttModel: payload.sttModel || null,
      ttsModel: payload.ttsModel || null,
      pii: payload.pii || callRow?.pii || "transcript",
      score,
      checks,
      diagnosis:
        storedScore != null
          ? textOf(callRow?.diagnosis, payload.diagnosis)
          : typeof diagnoseCall === "function" && scored
            ? diagnoseCall(scored)
            : null,
      scoreSource: storedScore != null ? "stored" : scored ? "scored" : null,
      nameAsks: scored?.nameAsks || 0,
      topFailure: topFailureFromChecks(checks),
      release: releaseKeyFromCall(columnRelease ? { ...payload, release: columnRelease } : payload, atIso),
      stages: Array.isArray(payload.stages) ? payload.stages : [],
    },
    turns: turns.map((turn) => {
      const card = byIndex.get(turn.turnIndex) || null;
      const latency = stage(turn, "latency");
      const outcome = stage(turn, "outcome");
      const tts = stage(turn, "tts");
      return {
        turnIndex: turn.turnIndex ?? null,
        at: turn.at || null,
        caller: {
          text: turn.caller?.text || "",
          language: turn.caller?.language || null,
        },
        spoken: tts?.text || card?.spoken || "",
        outcome: outcome?.value || null,
        score: card ? card.score : null,
        omit: Boolean(card?.omit),
        checks: card?.checks || {},
        notes: card?.notes || [],
        latency: {
          callerStopToModelFirstTokenMs: latency?.callerStopToModelFirstTokenMs ?? null,
          callerStopToFirstTtsPcmMs: latency?.callerStopToFirstTtsPcmMs ?? null,
        },
        stages: Array.isArray(turn.stages) ? turn.stages : [],
      };
    }),
  };
}

function listReleaseDeltasFromRows({ rows, scoreTurns, diagnoseCall, businessId }) {
  let calls = scoreTraceRows(rows, scoreTurns, diagnoseCall);
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
  scoreTraceRows,
  listBusinessQuality,
  getBusinessQuality,
  getCallTrace,
  listReleaseDeltasFromRows,
  emptyHome,
  emptyBusiness,
  emptyCall,
  emptyReleases,
};
