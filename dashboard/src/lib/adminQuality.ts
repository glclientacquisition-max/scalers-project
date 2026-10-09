import "server-only";

import { logAdminError } from "./adminErrors";
import {
  emptyChecks,
  couldntAnswerQuestions,
  repeatFailuresFromCalls,
  sortWorstFirst,
  VOICE_CHECKS,
  type BusinessQualityDetail,
  type BusinessQualityRow,
  type QualityBadge,
  type QualityCallSummary,
  type QualityRange,
  type ReleaseDelta,
  type VoiceCallTrace,
  type VoiceCheckCounts,
  type VoiceCheckName,
  type VoiceRelease,
  type VoiceStage,
  type VoiceTurnTrace,
} from "./adminQualityModel";
import {
  getBusinessQuality as readBusinessQuality,
  getCallTrace as readCallTrace,
  listBusinessQuality as readBusinessList,
  listCallTurns,
  listReleaseDeltas as readReleaseDeltas,
  readBusinessNames,
  readCallMedia,
} from "./quality/readQuality";

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
 * Super Admin Quality screens. `quality/readQuality.ts` is the only reader of
 * `voice_turn_traces`, and `quality/rollup.js` owns Dropping and release math.
 * This file only reshapes those bodies into the desk view model.
 */

const RANGE_DAYS: Record<QualityRange, number> = { "7d": 7, "30d": 30 };
const RELEASE_WINDOW_DAYS = 30;
const CALL_LIMIT = 100;

type RollupRelease = {
  key: string;
  gitSha: string | null;
  branch: string | null;
  label: string | null;
  firstCallAt: string | null;
  score: number | null;
  checks: Record<string, number> | null;
};

type RollupBusiness = {
  businessId: string | null;
  businessName?: string | null;
  currentScore: number | null;
  topFailure: { check: string; count: number } | null;
  dropping: boolean;
  droppingReason: string | null;
  callCount: number;
  checkedCount?: number;
  scores?: number[];
  lastCallAt?: string | null;
};

type ReaderTurn = {
  callId: string | null;
  tenantId: string | null;
  turnIndex: number | null;
  at: string | null;
  caller: {
    text: string;
    language: string | null;
    confidence: number | null;
    detected: string | null;
    sticky: string | null;
  };
  score: number | null;
  checks: Record<string, unknown> | null;
  stages: unknown[];
};

export async function listBusinessQuality(range: QualityRange): Promise<BusinessQualityRow[]> {
  const now = await requestNow();
  const body = await readBusinessList({ windowDays: RANGE_DAYS[range], now });
  if (!body.ready) return [];
  const rows = (body.businesses as RollupBusiness[]).flatMap((business) => {
    const row = toBusinessRow(business);
    return row && row.callsTraced > 0 ? [row] : [];
  });
  return sortWorstFirst(rows);
}

export async function getBusinessQuality(
  businessId: string,
  range: QualityRange,
): Promise<BusinessQualityDetail | null> {
  const id = businessId.trim();
  if (!id) return null;
  const now = await requestNow();
  const body = await readBusinessQuality({ businessId: id, limit: CALL_LIMIT, windowDays: RANGE_DAYS[range], now });
  if (!body || !body.ready || body.calls.length === 0) return null;
  const row = toBusinessRow({ ...(body as RollupBusiness), businessId: id });
  if (!row) return null;
  const callIds = body.calls.map((call: { callId: string }) => call.callId);
  const [media, turns] = await Promise.all([readCallMedia(callIds), listCallTurns(callIds)]);
  const summaries: QualityCallSummary[] = body.calls.map(
    (call: { callId: string; at: string | null; score: number | null; checks: unknown }) => ({
      callId: call.callId,
      score: call.score,
      checks: asChecks(call.checks),
      durationSec: media.get(call.callId)?.durationSec ?? null,
      at: call.at || "",
    }),
  );
  return {
    ...row,
    calls: sortWorstFirst(summaries),
    repeatFailures: repeatFailuresFromCalls(summaries),
    couldntAnswer: couldntAnswerQuestions((turns as ReaderTurn[]).map(toTurn)),
  };
}

export async function getCallTrace(callId: string): Promise<VoiceCallTrace | null> {
  const id = callId.trim();
  if (!id) return null;
  const body = await readCallTrace(id);
  if (!body || !body.ready || !body.call) return null;
  const call = body.call;
  const tenantId = textOr(call.tenantId, "");
  const callKey = textOr(call.callId, id);
  const [names, media] = await Promise.all([
    tenantId ? readBusinessNames([tenantId]) : Promise.resolve({} as Record<string, string | null>),
    readCallMedia([callKey]),
  ]);
  const turns = (body.turns as ReaderTurn[]).map(toTurn).toSorted((a, b) => a.turnIndex - b.turnIndex);
  return {
    schema: "scalers.voice.call",
    schemaVersion: 1,
    callId: callKey,
    tenantId,
    businessId: tenantId,
    businessName: names[tenantId]?.trim() || "Business",
    startedAt: textOr(call.startedAt, turns[0]?.at || ""),
    endedAt: typeof call.endedAt === "string" ? call.endedAt : null,
    turnCount: finiteNumber(call.turnCount) ?? turns.length,
    voiceId: typeof call.voiceId === "string" ? call.voiceId : null,
    sttModel: typeof call.sttModel === "string" ? call.sttModel : null,
    ttsModel: typeof call.ttsModel === "string" ? call.ttsModel : null,
    greeting: parseStages(call.stages),
    turns,
    score: finiteNumber(call.score),
    checks: asChecks(call.checks),
    diagnosis: textOrNull(call.diagnosis),
    release: toRelease(call.release),
    recordingUrl: await playableRecording(media.get(callKey)?.recordingUrl ?? null),
  };
}

/** Consecutive releases that both carry a git SHA, newest first. */
export async function listReleaseDeltas(): Promise<ReleaseDelta[]> {
  const now = await requestNow();
  const body = await readReleaseDeltas({ windowDays: RELEASE_WINDOW_DAYS, now });
  if (!body.ready) return [];
  return releaseDeltasFromGroups(body.releases as RollupRelease[]);
}

/** Pairs each release group with the one before it. Groups without a SHA are dropped. */
export function releaseDeltasFromGroups(groups: readonly RollupRelease[]): ReleaseDelta[] {
  const shaGroups = groups.filter((group) => Boolean(group.gitSha?.trim()));
  const deltas: ReleaseDelta[] = [];
  for (let i = 1; i < shaGroups.length; i += 1) {
    const before = shaGroups[i - 1]!;
    const after = shaGroups[i]!;
    deltas.push({
      release: { gitSha: after.gitSha || "", branch: after.branch || "", label: after.label || "" },
      at: after.firstCallAt,
      before: { avgScore: before.score, checks: asChecks(before.checks) ?? emptyChecks() },
      after: { avgScore: after.score, checks: asChecks(after.checks) ?? emptyChecks() },
    });
  }
  return deltas.toReversed();
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

/**
 * `.catch` handler for Overview and Businesses. A Quality failure logs and
 * leaves the badges empty so those screens still load.
 */
export function noQualityBadges(scope: string): (err: unknown) => Record<string, QualityBadge> {
  return (err) => {
    logAdminError(scope, err);
    return {};
  };
}

function toBusinessRow(business: RollupBusiness): BusinessQualityRow | null {
  const businessId = textOr(business.businessId, "");
  if (!businessId) return null;
  const top = business.topFailure?.check;
  return {
    businessId,
    name: business.businessName?.trim() || "Business",
    score: business.currentScore,
    trend: Array.isArray(business.scores) ? business.scores : [],
    topFailure: isCheck(top) ? top : null,
    checksLogged: (business.checkedCount ?? 0) > 0,
    dropping: Boolean(business.dropping),
    droppingReason: business.droppingReason || "",
    callsTraced: business.callCount,
    lastCallAt: business.lastCallAt ?? null,
  };
}

function toTurn(row: ReaderTurn): VoiceTurnTrace {
  const turn: VoiceTurnTrace = {
    schema: "scalers.voice.turn",
    schemaVersion: 1,
    callId: row.callId || "",
    tenantId: row.tenantId || "",
    turnIndex: finiteNumber(row.turnIndex) ?? 0,
    pii: "transcript",
    at: row.at || "",
    voiceId: null,
    caller: {
      text: row.caller?.text || "",
      language: row.caller?.language || "",
      confidence: row.caller?.confidence ?? null,
      ...(row.caller?.detected ? { detected: row.caller.detected } : {}),
      ...(row.caller?.sticky ? { sticky: row.caller.sticky } : {}),
    },
    stages: parseStages(row.stages),
    rawStages: Array.isArray(row.stages) ? row.stages : [],
    score: finiteNumber(row.score),
    checks: asChecks(row.checks),
  };
  return turn;
}

function isCheck(value: unknown): value is VoiceCheckName {
  return typeof value === "string" && (VOICE_CHECKS as readonly string[]).includes(value);
}

function toRelease(value: unknown): VoiceRelease | null {
  const row = asRecord(value);
  const gitSha = textOr(row.gitSha, "");
  const branch = textOr(row.branch, "");
  const label = textOr(row.label, "");
  if (!gitSha && !branch && !label) return null;
  return { gitSha, branch, label };
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
  if (stage === "filler") {
    return {
      stage: "filler",
      text: textOr(row.text, ""),
      before: textOr(row.before, ""),
      language: textOr(row.language, ""),
      ...(typeof row.played === "boolean" ? { played: row.played } : {}),
    };
  }
  if (stage === "tool") {
    return {
      stage: "tool",
      name: textOr(row.name, ""),
      status: typeof row.status === "string" ? row.status : "",
      args: textOr(row.args, ""),
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

/** Lets Date.now run at request time. Unit tests have no Next runtime. */
async function requestNow(): Promise<number> {
  if (process.env.NEXT_RUNTIME) {
    const { connection } = await import("next/server");
    await connection();
  }
  return Date.now();
}

