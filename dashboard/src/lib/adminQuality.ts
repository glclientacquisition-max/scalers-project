import "server-only";

import { getSupabaseAdmin } from "./supabase";
import {
  checkLabel,
  couldntAnswerQuestions,
  emptyChecks,
  repeatFailuresFromCalls,
  sortWorstFirst,
  topCheck,
  VOICE_CHECKS,
  type BusinessQualityDetail,
  type BusinessQualityRow,
  type QualityBadge,
  type QualityCallSummary,
  type QualityRange,
  type ReleaseDelta,
  type ReleaseSide,
  type VoiceCallTrace,
  type VoiceCheckCounts,
  type VoiceRelease,
  type VoiceStage,
  type VoiceTurnTrace,
} from "./adminQualityModel";

export type {
  BusinessQualityDetail,
  BusinessQualityRow,
  QualityBadge,
  QualityCallSummary,
  QualityRange,
  ReleaseDelta,
  RepeatFailure,
  VoiceCallTrace,
  VoiceCheckCounts,
  VoiceCheckName,
  VoiceTurnTrace,
} from "./adminQualityModel";

/**
 * Super Admin quality reads. Service role only, behind the admin layout guard.
 * `public.voice_turn_traces` holds call rows (score, checks, diagnosis, release)
 * and turn rows. Per-turn checks are not stored. Dropping is computed here.
 * A missing client or a missing table returns empty. Other query errors throw.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const DROP_POINTS = 10;
const MIN_WINDOW_CALLS = 5;
const NEW_CHECK_CALLS = 3;
const RANGE_DAYS: Record<QualityRange, number> = { "7d": 7, "30d": 30 };
const RELEASE_LOOKBACK_DAYS = 90;

export type DroppingSample = {
  at: string;
  score: number | null;
  checks: VoiceCheckCounts;
};

type CallSample = DroppingSample & {
  callId: string;
  tenantId: string;
  diagnosis: string | null;
  release: VoiceRelease | null;
  payload: Record<string, unknown>;
};

type TraceRow = {
  call_id: string;
  tenant_id: string | null;
  turn_index: number | null;
  record_kind: string;
  score: number | string | null;
  checks: unknown;
  diagnosis: string | null;
  release: unknown;
  payload: unknown;
  created_at: string;
};

/** Last 7 days at least 10 below the prior 7, or a new check on at least 3 calls. */
export function droppingVerdict(
  calls: readonly DroppingSample[],
  now = Date.now(),
): { dropping: boolean; droppingReason: string } {
  const recentStart = now - WEEK_MS;
  const priorStart = now - 2 * WEEK_MS;
  const recent: DroppingSample[] = [];
  const prior: DroppingSample[] = [];
  for (const call of calls) {
    const at = Date.parse(call.at);
    if (!Number.isFinite(at) || at > now) continue;
    if (at >= recentStart) recent.push(call);
    else if (at >= priorStart) prior.push(call);
  }

  const recentScored = recent.filter((call) => call.score != null && Number.isFinite(call.score));
  const priorScored = prior.filter((call) => call.score != null && Number.isFinite(call.score));
  if (recentScored.length >= MIN_WINDOW_CALLS && priorScored.length >= MIN_WINDOW_CALLS) {
    const drop = average(priorScored.map((call) => call.score as number)) - average(recentScored.map((call) => call.score as number));
    if (drop >= DROP_POINTS) {
      return { dropping: true, droppingReason: `Score fell ${Math.round(drop)} points in 7 days` };
    }
  }

  const fresh = emptyChecks();
  for (const check of VOICE_CHECKS) {
    const priorHits = prior.filter((call) => (call.checks[check] || 0) > 0).length;
    const recentHits = recent.filter((call) => (call.checks[check] || 0) > 0).length;
    if (priorHits === 0 && recentHits >= NEW_CHECK_CALLS) fresh[check] = recentHits;
  }
  const named = topCheck(fresh);
  if (named) {
    return { dropping: true, droppingReason: `${checkLabel(named)} on ${fresh[named]} calls` };
  }
  return { dropping: false, droppingReason: "" };
}

export function releaseDeltasFromCalls(
  calls: readonly Array<DroppingSample & { release: VoiceRelease | null }>,
): ReleaseDelta[] {
  const sorted = calls.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const runs: Array<Array<(typeof sorted)[number]>> = [];
  for (const call of sorted) {
    const sha = call.release?.gitSha.trim() || "";
    const prev = runs[runs.length - 1];
    const prevSha = prev?.[0]?.release?.gitSha.trim() || "";
    if (prev && prevSha === sha) prev.push(call);
    else runs.push([call]);
  }
  const deltas: ReleaseDelta[] = [];
  for (let i = 1; i < runs.length; i += 1) {
    const after = runs[i];
    const before = runs[i - 1];
    const release = after?.[0]?.release;
    if (!after || !before || before.length === 0 || !release?.gitSha.trim()) continue;
    deltas.push({ release, before: releaseSide(before), after: releaseSide(after) });
  }
  return deltas.toReversed();
}

export async function listBusinessQuality(range: QualityRange): Promise<BusinessQualityRow[]> {
  const now = Date.now();
  const lookbackDays = Math.max(RANGE_DAYS[range], 14);
  const calls = await fetchCallSamples(new Date(now - lookbackDays * DAY_MS).toISOString());
  if (!calls) return [];
  return businessRows(calls, range, now);
}

export async function getBusinessQuality(
  businessId: string,
  range: QualityRange,
): Promise<BusinessQualityDetail | null> {
  const id = businessId.trim();
  if (!id) return null;
  const now = Date.now();
  const lookbackDays = Math.max(RANGE_DAYS[range], 14);
  const calls = await fetchCallSamples(new Date(now - lookbackDays * DAY_MS).toISOString(), id);
  if (!calls) return null;
  const row = businessRows(calls, range, now)[0];
  if (!row) return null;
  const visible = calls.filter((call) => Date.parse(call.at) >= now - RANGE_DAYS[range] * DAY_MS);
  const summaries = await callSummaries(visible);
  const turns = await fetchTurns(visible.map((call) => call.callId));
  return {
    ...row,
    calls: sortWorstFirst(summaries),
    repeatFailures: repeatFailuresFromCalls(summaries),
    couldntAnswer: couldntAnswerQuestions(turns),
  };
}

export async function getCallTrace(callId: string): Promise<VoiceCallTrace | null> {
  const id = callId.trim();
  if (!id) return null;
  const admin = adminOrNull();
  if (!admin) return null;
  const { data, error } = await admin
    .from("voice_turn_traces")
    .select("call_id, tenant_id, turn_index, record_kind, score, checks, diagnosis, release, payload, created_at")
    .eq("call_id", id);
  if (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
  const rows = (data || []) as TraceRow[];
  const callRows = rows.filter((row) => row.record_kind === "call");
  const callRow = callRows.toSorted((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!callRow) return null;

  const payload = asRecord(callRow.payload);
  const tenantId = textOr(callRow.tenant_id, textOr(payload.tenantId, ""));
  const [name, media] = await Promise.all([
    tenantId ? businessName(tenantId) : Promise.resolve("Business"),
    callMedia(id),
  ]);
  const recordingUrl = await playableRecording(media.recordingUrl);
  const turnRows = rows
    .filter((row) => row.record_kind === "turn")
    .toSorted((a, b) => (a.turn_index ?? 0) - (b.turn_index ?? 0));

  return {
    schema: "scalers.voice.call",
    schemaVersion: 1,
    callId: textOr(payload.callId, callRow.call_id),
    tenantId,
    businessId: tenantId,
    businessName: name,
    startedAt: textOr(payload.startedAt, callRow.created_at),
    endedAt: typeof payload.endedAt === "string" ? payload.endedAt : null,
    turnCount: finiteNumber(payload.turnCount) ?? turnRows.length,
    voiceId: typeof payload.voiceId === "string" ? payload.voiceId : null,
    sttModel: typeof payload.sttModel === "string" ? payload.sttModel : null,
    ttsModel: typeof payload.ttsModel === "string" ? payload.ttsModel : null,
    greeting: parseStages(payload.stages),
    turns: turnRows.map(toTurn),
    score: finiteNumber(callRow.score) ?? finiteNumber(payload.score),
    checks: asChecks(callRow.checks) ?? asChecks(payload.checks) ?? emptyChecks(),
    diagnosis: textOrNull(callRow.diagnosis) ?? textOrNull(payload.diagnosis),
    release: asRelease(callRow.release) ?? asRelease(payload.release),
    recordingUrl,
  };
}

export async function listReleaseDeltas(): Promise<ReleaseDelta[]> {
  const since = new Date(Date.now() - RELEASE_LOOKBACK_DAYS * DAY_MS).toISOString();
  const calls = await fetchCallSamples(since);
  if (!calls) return [];
  return releaseDeltasFromCalls(calls);
}

/** Score and Dropping marker for Businesses rows and Overview. */
export async function qualityBadges(): Promise<Record<string, QualityBadge>> {
  const rows = await listBusinessQuality("7d");
  const badges: Record<string, QualityBadge> = {};
  for (const row of rows) {
    badges[row.businessId] = {
      score: row.score,
      dropping: row.dropping,
      droppingReason: row.droppingReason,
    };
  }
  return badges;
}

function businessRows(calls: readonly CallSample[], range: QualityRange, now: number): BusinessQualityRow[] {
  const displaySince = now - RANGE_DAYS[range] * DAY_MS;
  const byTenant = new Map<string, CallSample[]>();
  for (const call of calls) {
    if (!call.tenantId) continue;
    const list = byTenant.get(call.tenantId) || [];
    list.push(call);
    byTenant.set(call.tenantId, list);
  }
  const rows: BusinessQualityRow[] = [];
  for (const [tenantId, samples] of byTenant) {
    const visible = samples
      .filter((call) => {
        const at = Date.parse(call.at);
        return Number.isFinite(at) && at >= displaySince && at <= now;
      })
      .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (visible.length === 0) continue;
    const verdict = droppingVerdict(samples, now);
    const scores = visible.flatMap((call) => (call.score == null ? [] : [call.score]));
    const totals = emptyChecks();
    for (const call of visible) {
      for (const check of VOICE_CHECKS) totals[check] += call.checks[check] || 0;
    }
    const latest = visible[visible.length - 1];
    rows.push({
      businessId: tenantId,
      name: nameFrom(samples) || "Business",
      score: scores.length ? round1(average(scores)) : null,
      trend: scores,
      topFailure: topCheck(totals),
      dropping: verdict.dropping,
      droppingReason: verdict.droppingReason,
      callsTraced: visible.length,
      lastCallAt: latest?.at || null,
    });
  }
  return sortWorstFirst(rows);
}

function nameFrom(samples: readonly CallSample[]): string {
  for (const sample of samples) {
    const name = sample.payload.businessName;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "";
}

async function callSummaries(calls: readonly CallSample[]): Promise<QualityCallSummary[]> {
  const media = await callMediaById(calls.map((call) => call.callId));
  return calls.map((call) => ({
    callId: call.callId,
    score: call.score,
    checks: call.checks,
    durationSec: media.get(call.callId)?.durationSec ?? null,
    at: call.at,
  }));
}

async function fetchCallSamples(since: string, tenantId?: string): Promise<CallSample[] | null> {
  const admin = adminOrNull();
  if (!admin) return null;
  let query = admin
    .from("voice_turn_traces")
    .select("call_id, tenant_id, score, checks, diagnosis, release, payload, created_at")
    .eq("record_kind", "call")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error) {
    if (missingRelation(error)) return null;
    throw error;
  }
  const samples = ((data || []) as TraceRow[]).flatMap((row) => {
    const sample = toCallSample(row);
    return sample ? [sample] : [];
  });
  await attachBusinessNames(samples);
  return samples;
}

async function businessName(tenantId: string): Promise<string> {
  const admin = adminOrNull();
  if (!admin) return "Business";
  const { data, error } = await admin.from("tenants").select("business_name").eq("id", tenantId).maybeSingle();
  if (error) throw error;
  const name = (data as { business_name?: string | null } | null)?.business_name?.trim() || "";
  return name || "Business";
}

async function attachBusinessNames(samples: CallSample[]): Promise<void> {
  const ids = [...new Set(samples.map((sample) => sample.tenantId).filter(Boolean))];
  if (ids.length === 0) return;
  const admin = adminOrNull();
  if (!admin) return;
  const { data, error } = await admin.from("tenants").select("id, business_name").in("id", ids);
  if (error) throw error;
  const names = new Map<string, string>();
  for (const row of (data || []) as Array<{ id: string; business_name: string | null }>) {
    const name = row.business_name?.trim() || "";
    if (name) names.set(row.id, name);
  }
  for (const sample of samples) {
    const name = names.get(sample.tenantId);
    if (name) sample.payload = { ...sample.payload, businessName: name };
  }
}

async function fetchTurns(callIds: readonly string[]): Promise<VoiceTurnTrace[]> {
  const ids = [...new Set(callIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return [];
  const admin = adminOrNull();
  if (!admin) return [];
  const { data, error } = await admin
    .from("voice_turn_traces")
    .select("call_id, tenant_id, turn_index, payload, checks, created_at")
    .eq("record_kind", "turn")
    .in("call_id", ids)
    .order("turn_index", { ascending: true })
    .limit(5000);
  if (error) {
    if (missingRelation(error)) return [];
    throw error;
  }
  return ((data || []) as TraceRow[]).map(toTurn);
}

function toCallSample(row: TraceRow): CallSample | null {
  const payload = asRecord(row.payload);
  const callId = textOr(payload.callId, row.call_id).trim();
  const tenantId = textOr(row.tenant_id, textOr(payload.tenantId, "")).trim();
  if (!callId) return null;
  const at = textOr(payload.startedAt, row.created_at);
  return {
    callId,
    tenantId,
    at,
    score: finiteNumber(row.score) ?? finiteNumber(payload.score),
    checks: asChecks(row.checks) ?? asChecks(payload.checks) ?? emptyChecks(),
    diagnosis: textOrNull(row.diagnosis) ?? textOrNull(payload.diagnosis),
    release: asRelease(row.release) ?? asRelease(payload.release),
    payload,
  };
}

function toTurn(row: TraceRow): VoiceTurnTrace {
  const payload = asRecord(row.payload);
  const caller = asRecord(payload.caller);
  const checks = asChecks(payload.checks) ?? asChecks(row.checks);
  const turn: VoiceTurnTrace = {
    schema: "scalers.voice.turn",
    schemaVersion: 1,
    callId: textOr(payload.callId, row.call_id),
    tenantId: textOr(row.tenant_id, textOr(payload.tenantId, "")),
    turnIndex: finiteNumber(row.turn_index) ?? finiteNumber(payload.turnIndex) ?? 0,
    pii: "transcript",
    at: textOr(payload.at, row.created_at),
    voiceId: typeof payload.voiceId === "string" ? payload.voiceId : null,
    caller: {
      text: typeof caller.text === "string" ? caller.text : "",
      language: typeof caller.language === "string" ? caller.language : "",
      confidence: finiteNumber(caller.confidence),
    },
    stages: parseStages(payload.stages),
    rawStages: Array.isArray(payload.stages) ? payload.stages : [],
  };
  if (checks) turn.checks = checks;
  return turn;
}

type CallMedia = { durationSec: number | null; recordingUrl: string | null };

async function callMedia(callId: string): Promise<CallMedia> {
  const map = await callMediaById([callId]);
  return map.get(callId) || { durationSec: null, recordingUrl: null };
}

async function callMediaById(callIds: readonly string[]): Promise<Map<string, CallMedia>> {
  const map = new Map<string, CallMedia>();
  const ids = [...new Set(callIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return map;
  const admin = adminOrNull();
  if (!admin) return map;
  const { data, error } = await admin
    .from("calls")
    .select("sautikit_call_sid, duration_seconds, recording_url")
    .in("sautikit_call_sid", ids);
  if (error) throw error;
  for (const row of (data || []) as Array<{
    sautikit_call_sid: string | null;
    duration_seconds: number | null;
    recording_url: string | null;
  }>) {
    const sid = row.sautikit_call_sid?.trim() || "";
    if (!sid) continue;
    map.set(sid, {
      durationSec: finiteNumber(row.duration_seconds),
      recordingUrl: httpUrl(row.recording_url),
    });
  }
  return map;
}

/** 403 and 404 are an empty recording. Other failures stay on the player. */
async function playableRecording(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 403 || res.status === 404) return null;
    return url;
  } catch {
    return url;
  }
}

function releaseSide(calls: readonly DroppingSample[]): ReleaseSide {
  const scores = calls.flatMap((call) => (call.score == null || !Number.isFinite(call.score) ? [] : [call.score]));
  const checks = emptyChecks();
  for (const call of calls) {
    for (const key of VOICE_CHECKS) checks[key] += call.checks[key] || 0;
  }
  return { avgScore: scores.length ? round1(average(scores)) : null, checks };
}

function parseStages(value: unknown): VoiceStage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const stage = parseStage(item);
    return stage ? [stage] : [];
  });
}

function parseStage(value: unknown): VoiceStage | null {
  const row = asRecord(value);
  const stage = row.stage;
  if (typeof stage !== "string") return null;
  if (stage === "stt") {
    const kind = row.kind === "final" ? "final" : "interim";
    const tokens = Array.isArray(row.tokens)
      ? row.tokens.flatMap((token) => {
          const item = asRecord(token);
          if (typeof item.text !== "string") return [];
          return [
            {
              text: item.text,
              final: item.final === true,
              language: typeof item.language === "string" ? item.language : "",
              startMs: finiteNumber(item.startMs),
              endMs: finiteNumber(item.endMs),
            },
          ];
        })
      : [];
    return { stage: "stt", kind, text: textOr(row.text, ""), tokens };
  }
  if (stage === "turn_end") {
    return { stage: "turn_end", decision: textOr(row.decision, ""), reason: textOr(row.reason, "") };
  }
  if (stage === "language") {
    return {
      stage: "language",
      detected: textOr(row.detected, ""),
      sticky: textOr(row.sticky, ""),
      confidence: finiteNumber(row.confidence),
    };
  }
  if (stage === "model" && row.phase === "request") {
    return {
      stage: "model",
      phase: "request",
      provider: textOr(row.provider, ""),
      model: textOr(row.model, ""),
      promptId: textOr(row.promptId, ""),
      promptVersion: typeof row.promptVersion === "string" ? row.promptVersion : null,
      language: textOr(row.language, ""),
    };
  }
  if (stage === "model" && row.phase === "output") {
    return {
      stage: "model",
      phase: "output",
      provider: typeof row.provider === "string" ? row.provider : undefined,
      model: typeof row.model === "string" ? row.model : undefined,
      promptId: typeof row.promptId === "string" ? row.promptId : undefined,
      outputText: typeof row.outputText === "string" ? row.outputText : null,
      chars: finiteNumber(row.chars) ?? 0,
      spokenEmitted: finiteNumber(row.spokenEmitted),
    };
  }
  if (stage === "transform") {
    const before = textOr(row.before, "");
    return {
      stage: "transform",
      name: textOr(row.name, ""),
      reason: textOr(row.reason, ""),
      before,
      after: textOr(row.after, ""),
      dropped: typeof row.dropped === "string" ? row.dropped : row.dropped === true ? before : "",
    };
  }
  if (stage === "canned") {
    return { stage: "canned", path: textOr(row.path, ""), text: textOr(row.text, "") };
  }
  if (stage === "tts") {
    return {
      stage: "tts",
      text: textOr(row.text, ""),
      before: textOr(row.before, ""),
      language: textOr(row.language, ""),
      voiceId: typeof row.voiceId === "string" ? row.voiceId : null,
    };
  }
  if (stage === "barge_in") {
    return { stage: "barge_in", reason: textOr(row.reason, "") };
  }
  if (stage === "latency") {
    return {
      stage: "latency",
      callerStopToModelFirstTokenMs: finiteNumber(row.callerStopToModelFirstTokenMs),
      callerStopToFirstTtsPcmMs: finiteNumber(row.callerStopToFirstTtsPcmMs),
    };
  }
  if (stage === "outcome") {
    return { stage: "outcome", value: textOr(row.value, "") };
  }
  return null;
}

function asChecks(value: unknown): VoiceCheckCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const checks = emptyChecks();
  for (const key of VOICE_CHECKS) {
    const n = finiteNumber(row[key]);
    checks[key] = n != null && n > 0 ? n : 0;
  }
  return checks;
}

function asRelease(value: unknown): VoiceRelease | null {
  const row = asRecord(value);
  const gitSha = textOr(row.gitSha, "");
  const branch = textOr(row.branch, "");
  const label = textOr(row.label, "");
  if (!gitSha && !branch && !label) return null;
  return { gitSha, branch, label };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function adminOrNull() {
  try {
    return getSupabaseAdmin();
  } catch {
    return null;
  }
}

function missingRelation(error: { code?: string; message?: string }): boolean {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const message = error.message || "";
  return /voice_turn_traces/i.test(message) && /does not exist|schema cache/i.test(message);
}
