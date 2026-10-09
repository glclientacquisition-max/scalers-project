/**
 * Voice quality view model for Super Admin.
 * Shape follows trace schema v1 (`scalers.voice.turn` / `scalers.voice.call`)
 * plus the call row: score, per-check counts, diagnosis, and release.
 * A turn score, per-turn checks, detected language, tool stages, and filler
 * stages are optional. Older calls omit them. Business rows add
 * `dropping` and `droppingReason`, computed once in `quality/rollup.js`.
 * Checks that were never stored stay null and read "Not logged".
 *
 * Reads live in `quality/readQuality.ts` (server-only); `adminQuality.ts`
 * reshapes them for these types. This file is pure so the desk, the dev
 * harness, and tests can share it.
 */

export const VOICE_CHECKS = [
  "languageMismatch",
  "incomplete",
  "repeatedQuestion",
  "silence",
  "deletedAnswer",
  "respelling",
  "prematureTurn",
  "slow",
] as const;

export type VoiceCheckName = (typeof VOICE_CHECKS)[number];

export type VoiceCheckCounts = Record<VoiceCheckName, number>;

export type QualityRange = "7d" | "30d";

export const LATENCY_BUDGET_MS = 1200;

/**
 * Turn outcomes that count as Couldn't answer. Literals from Brain.
 * Compared lowercase. `speech_repair` is a retry, not a miss, so it stays out.
 */
export const COULDNT_ANSWER_OUTCOMES = ["error", "stream_timeout", "speech_guarantee", "speech_quiet"] as const;

/** Canned paths that count as Couldn't answer. Literals from Brain. Compared lowercase. */
export const COULDNT_ANSWER_CANNED = ["llm_recovery", "llm_unavailable", "speech_guarantee"] as const;

/** Higher impact first. Ties in `topCheck` break toward this order. */
const CHECK_SEVERITY: readonly VoiceCheckName[] = [
  "silence",
  "deletedAnswer",
  "incomplete",
  "languageMismatch",
  "repeatedQuestion",
  "prematureTurn",
  "respelling",
  "slow",
];

/** Same words as `quality/rollup.js` CHECK_LABELS, which writes Dropping reasons. */
export const CHECK_LABELS: Record<VoiceCheckName, string> = {
  languageMismatch: "Wrong language",
  incomplete: "Incomplete answer",
  repeatedQuestion: "Repeated question",
  silence: "Silence",
  deletedAnswer: "Deleted answer",
  respelling: "Respelling",
  prematureTurn: "Cut off early",
  slow: "Slow reply",
};

const CANNED_LABELS: Record<string, string> = {
  greeting: "Greeting",
  file_name_ask: "Name ask",
  visit_read: "Visit read",
  hear_again: "Hear again",
  speech_repair: "Speech repair",
  llm_recovery: "Recovery line",
};

export type SttToken = {
  text: string;
  final: boolean;
  language: string;
  startMs: number | null;
  endMs: number | null;
};

export type VoiceStage =
  | { stage: "stt"; kind: "interim" | "final"; text: string; tokens: SttToken[] }
  | { stage: "turn_end"; decision: string; reason: string }
  | { stage: "language"; detected: string; sticky: string; confidence: number | null }
  | {
      stage: "model";
      phase: "request";
      provider: string;
      model: string;
      promptId: string;
      promptVersion: string | null;
      language: string;
    }
  | {
      stage: "model";
      phase: "output";
      provider?: string;
      model?: string;
      promptId?: string;
      outputText: string | null;
      chars: number;
      spokenEmitted: number | null;
    }
  | { stage: "transform"; name: string; reason: string; before: string; after: string; dropped: string }
  | { stage: "canned"; path: string; text: string }
  | { stage: "tts"; text: string; before: string; language: string; voiceId: string | null }
  | { stage: "filler"; text: string; before: string; language: string; played?: boolean }
  | { stage: "tool"; name: string; status: string; args: string }
  | { stage: "barge_in"; reason: string }
  | {
      stage: "latency";
      callerStopToModelFirstTokenMs: number | null;
      callerStopToFirstTtsPcmMs: number | null;
    }
  | { stage: "outcome"; value: string };

export type VoiceTurnTrace = {
  schema: "scalers.voice.turn";
  schemaVersion: 1;
  callId: string;
  tenantId: string;
  turnIndex: number;
  pii: "transcript";
  at: string;
  voiceId: string | null;
  caller: {
    text: string;
    language: string;
    confidence: number | null;
    /** Persisted detection. Absent on calls from before that field. */
    detected?: string;
    /** Persisted sticky language. Absent on older calls. */
    sticky?: string;
  };
  stages: VoiceStage[];
  /**
   * Per-turn check hits. Null or absent when the turn row stored none, which
   * reads "Not logged". Never filled from call-level checks.
   */
  checks?: VoiceCheckCounts | null;
  /** Per-turn score Voice stored. Null reads "Not logged". */
  score?: number | null;
  /** Persisted stage list, including stages the timeline does not render. */
  rawStages?: unknown;
};

export type VoiceRelease = {
  gitSha: string;
  branch: string;
  label: string;
};

export type VoiceCallTrace = {
  schema: "scalers.voice.call";
  schemaVersion: 1;
  callId: string;
  tenantId: string;
  businessId: string;
  businessName: string;
  startedAt: string;
  endedAt: string | null;
  turnCount: number;
  voiceId: string | null;
  sttModel: string | null;
  ttsModel: string | null;
  /** Greeting stages, same stage union as a turn. */
  greeting: VoiceStage[];
  turns: VoiceTurnTrace[];
  score: number | null;
  /** Null when the call row stored no checks. */
  checks: VoiceCheckCounts | null;
  /** Persisted one-line read. Null until the scorer stores one. */
  diagnosis: string | null;
  release: VoiceRelease | null;
  /**
   * Playable recording, or null when the call has none.
   * Omitted on fixtures. A 403 or 404 is stored as null.
   */
  recordingUrl?: string | null;
};

export type BusinessQualityRow = {
  businessId: string;
  name: string;
  score: number | null;
  /** Oldest to newest scores inside the selected range. */
  trend: number[];
  topFailure: VoiceCheckName | null;
  /** True when at least one call in the range stored its checks. */
  checksLogged: boolean;
  dropping: boolean;
  droppingReason: string;
  callsTraced: number;
  lastCallAt: string | null;
};

export type QualityCallSummary = {
  callId: string;
  score: number | null;
  checks: VoiceCheckCounts | null;
  durationSec: number | null;
  at: string;
};

export type RepeatFailure = {
  check: VoiceCheckName;
  calls: number;
};

export type BusinessQualityDetail = BusinessQualityRow & {
  calls: QualityCallSummary[];
  repeatFailures: RepeatFailure[];
  couldntAnswer: string[];
};

export type ReleaseSide = {
  avgScore: number | null;
  checks: VoiceCheckCounts;
};

export type ReleaseDelta = {
  release: VoiceRelease;
  /** First call on this release. Names the release on screen instead of the git SHA. */
  at: string | null;
  before: ReleaseSide;
  after: ReleaseSide;
};

export type QualityBadge = {
  score: number | null;
  dropping: boolean;
  droppingReason: string;
};

export type VoiceFixtureTurn = {
  caller: string;
  flushed: boolean;
  /** Null when the trace did not store it. Never filled with a guess. */
  model: {
    provider: string | null;
    model: string | null;
    promptId: string | null;
    outputText: string | null;
    chars: number;
    spokenEmitted: number | null;
  };
  canned?: { path: string; text: string };
  observed?: { firstPcmMs: number };
  unlogged?: true;
};

/** `tests/fixtures/voice-calls/` shape. A download, not a repo write. */
export type VoiceFixture = {
  schema: "scalers.voice.fixture";
  schemaVersion: 1;
  callId: string;
  tenantId: string;
  businessName: string;
  callerName: string | null;
  nameOnFile: boolean;
  source: string;
  turns: VoiceFixtureTurn[];
};

export function emptyChecks(): VoiceCheckCounts {
  return {
    languageMismatch: 0,
    incomplete: 0,
    repeatedQuestion: 0,
    silence: 0,
    deletedAnswer: 0,
    respelling: 0,
    prematureTurn: 0,
    slow: 0,
  };
}

export function parseQualityRange(raw: string | undefined): QualityRange {
  return raw === "30d" ? "30d" : "7d";
}

export function checkLabel(check: VoiceCheckName): string {
  return CHECK_LABELS[check];
}

export function cannedLabel(path: string): string {
  return CANNED_LABELS[path] || path.replaceAll("_", " ");
}

export function failingChecks(checks: VoiceCheckCounts | null | undefined): VoiceCheckName[] {
  if (!checks) return [];
  return CHECK_SEVERITY.filter((check) => (checks[check] || 0) > 0);
}

export function topCheck(checks: VoiceCheckCounts | null | undefined): VoiceCheckName | null {
  if (!checks) return null;
  let best: VoiceCheckName | null = null;
  let bestCount = 0;
  for (const check of CHECK_SEVERITY) {
    const count = checks[check] || 0;
    if (count > bestCount) {
      best = check;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The diagnosis Voice stored. Null means Voice could not score the call
 * (#621), so it reads "Not scored". Failing checks still show as chips.
 */
export function diagnosisLine(call: { diagnosis: string | null; checks?: VoiceCheckCounts | null }): string {
  return call.diagnosis?.trim() || "Not scored";
}

/** 0 calls, 1 call, 2 calls. */
export function callCountLabel(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return `${n} ${n === 1 ? "call" : "calls"}`;
}

export function formatScore(score: number | null): string {
  if (score == null || !Number.isFinite(score)) return "Not logged";
  const rounded = Math.round(score * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return "Not logged";
  const rounded = Math.round(delta * 10) / 10;
  const body = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
  if (rounded > 0) return `+${body}`;
  if (rounded < 0) return `-${body}`;
  return "0";
}

export function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "Not logged";
  const total = Math.max(0, Math.round(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

const releaseDay = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  timeZone: "Africa/Nairobi",
});

/** The release label, else "Release of 8 Oct". The git SHA stays off screen. */
export function releaseName(delta: { release: VoiceRelease; at: string | null }): string {
  const label = delta.release.label.trim();
  if (label) return label;
  const when = delta.at ? new Date(delta.at) : null;
  if (when && !Number.isNaN(when.getTime())) return `Release of ${releaseDay.format(when)}`;
  return "Release";
}

export function sortWorstFirst<T extends { score: number | null }>(rows: readonly T[]): T[] {
  return rows.toSorted((a, b) => {
    if (a.score == null && b.score == null) return 0;
    if (a.score == null) return 1;
    if (b.score == null) return -1;
    return a.score - b.score;
  });
}

export function qualityListHref(base: string, range: QualityRange): string {
  return range === "30d" ? `${base}?range=30d` : base;
}

export function qualityBusinessHref(base: string, businessId: string, range: QualityRange): string {
  const path = `${base}/${encodeURIComponent(businessId)}`;
  return range === "30d" ? `${path}?range=30d` : path;
}

export function qualityCallHref(base: string, callId: string): string {
  return `${base}/call/${encodeURIComponent(callId)}`;
}

function questionKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?？!！.]+$/g, "")
    .replace(/\s+/g, " ");
}

function isCouldntAnswerOutcome(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (COULDNT_ANSWER_OUTCOMES as readonly string[]).includes(normalized);
}

function turnMissed(turn: VoiceTurnTrace): boolean {
  for (const stage of turn.stages) {
    if (stage.stage === "canned" && (COULDNT_ANSWER_CANNED as readonly string[]).includes(stage.path.trim().toLowerCase())) {
      return true;
    }
    if (stage.stage === "outcome" && isCouldntAnswerOutcome(stage.value)) return true;
  }
  return false;
}

/**
 * Caller questions from turns whose outcome is in COULDNT_ANSWER_OUTCOMES, or
 * that played a COULDNT_ANSWER_CANNED line. Silence and deleted answer checks
 * do not count. Deduped by the caller question.
 */
export function couldntAnswerQuestions(turns: readonly VoiceTurnTrace[]): string[] {
  const seen = new Set<string>();
  const questions: string[] = [];
  for (const turn of turns) {
    if (!turnMissed(turn)) continue;
    const text = turn.caller.text.trim();
    if (!text) continue;
    const key = questionKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    questions.push(text);
  }
  return questions;
}

/** A check counts once per call, and only checks on more than one call repeat. */
export function repeatFailuresFromCalls(calls: readonly { checks: VoiceCheckCounts | null }[]): RepeatFailure[] {
  const hits = emptyChecks();
  for (const call of calls) {
    if (!call.checks) continue;
    for (const check of VOICE_CHECKS) {
      if ((call.checks[check] || 0) > 0) hits[check] += 1;
    }
  }
  return CHECK_SEVERITY.filter((check) => hits[check] > 1).map((check) => ({
    check,
    calls: hits[check],
  }));
}

export function droppingAttentionRows(
  badges: Record<string, QualityBadge>,
  businesses: readonly { id: string; name: string }[],
): Array<{ key: string; title: string; detail: string; href: string; stamp: string }> {
  const nameById = new Map(businesses.map((business) => [business.id, business.name]));
  const rows: Array<{ key: string; title: string; detail: string; href: string; stamp: string }> = [];
  for (const [id, badge] of Object.entries(badges)) {
    if (!badge.dropping) continue;
    rows.push({
      key: `quality-${id}`,
      title: nameById.get(id) || "Business",
      detail: badge.droppingReason,
      href: qualityBusinessHref("/admin/quality", id, "7d"),
      stamp: "Dropping",
    });
  }
  return rows;
}

function lastStage<T extends VoiceStage["stage"]>(
  stages: readonly VoiceStage[],
  stage: T,
  phase?: "request" | "output",
): Extract<VoiceStage, { stage: T }> | null {
  for (let i = stages.length - 1; i >= 0; i -= 1) {
    const row = stages[i];
    if (!row || row.stage !== stage) continue;
    if (phase && row.stage === "model" && row.phase !== phase) continue;
    return row as Extract<VoiceStage, { stage: T }>;
  }
  return null;
}

export function finalStt(turn: VoiceTurnTrace): { heard: string; language: string } {
  const stt = lastStage(turn.stages, "stt");
  if (!stt) return { heard: "", language: "" };
  const finals = stt.tokens.filter((token) => token.final);
  const tokens = finals.length > 0 ? finals : stt.tokens;
  const heard = tokens.map((token) => token.text).join(" ").trim() || stt.text;
  const language = tokens.find((token) => token.language)?.language || "";
  return { heard, language };
}

export function languageLine(turn: VoiceTurnTrace): string {
  const row = lastStage(turn.stages, "language");
  const detected = turn.caller.detected?.trim() || "";
  if (detected) {
    const sticky = (turn.caller.sticky || row?.sticky || turn.caller.language || "").trim();
    return sticky ? `Detected ${detected}. Sticky ${sticky}.` : `Detected ${detected}.`;
  }
  if (!row || (!row.detected && !row.sticky)) return "Not logged";
  return `Detected ${row.detected}. Sticky ${row.sticky}.`;
}

const TOOL_OK = new Set(["succeeded", "ok", "success", "updated"]);

/** Ok, Failed, or null when the trace stored no status. */
export function toolResultWord(status: string | null | undefined): "Ok" | "Failed" | null {
  const value = (status || "").trim().toLowerCase();
  if (!value) return null;
  return TOOL_OK.has(value) ? "Ok" : "Failed";
}

export type ToolFact = { name: string; result: "Ok" | "Failed" | "Not logged" };

export function toolFacts(turn: VoiceTurnTrace): ToolFact[] {
  return turn.stages.flatMap((stage) => {
    if (stage.stage !== "tool") return [];
    return [{ name: stage.name.trim(), result: toolResultWord(stage.status) ?? "Not logged" }];
  });
}

export function toolLines(turn: VoiceTurnTrace): string[] {
  return toolFacts(turn).map((fact) => (fact.name ? `${fact.name}. ${fact.result}` : fact.result));
}

export function fillerLines(turn: VoiceTurnTrace): string[] {
  return turn.stages.flatMap((stage) => {
    if (stage.stage !== "filler") return [];
    const head = stage.played === true ? "Played" : stage.played === false ? "Not played" : "Not logged";
    const text = stage.text.trim();
    return [text ? `${head}. ${text}` : head];
  });
}

/** What the model wrote before any transform. */
export function modelOutput(turn: VoiceTurnTrace): string | null {
  const row = lastStage(turn.stages, "model", "output");
  if (!row || row.stage !== "model" || row.phase !== "output") return null;
  const text = row.outputText?.trim() || "";
  return text || null;
}

export function spokenLine(turn: VoiceTurnTrace): { text: string; cannedPath: string | null; cannedText: string | null } {
  const tts = lastStage(turn.stages, "tts");
  const canned = lastStage(turn.stages, "canned");
  return {
    text: tts?.text?.trim() || "",
    cannedPath: canned?.path || null,
    cannedText: canned?.text?.trim() || null,
  };
}

export function bargeReason(turn: VoiceTurnTrace): string | null {
  const row = lastStage(turn.stages, "barge_in");
  const reason = row?.reason?.trim() || "";
  return reason || null;
}

export function latencyMs(turn: VoiceTurnTrace): {
  firstToken: number | null;
  firstAudio: number | null;
} {
  const row = lastStage(turn.stages, "latency");
  if (!row) return { firstToken: null, firstAudio: null };
  return {
    firstToken: row.callerStopToModelFirstTokenMs,
    firstAudio: row.callerStopToFirstTtsPcmMs,
  };
}

export function transformRows(turn: VoiceTurnTrace): Array<{
  name: string;
  reason: string;
  before: string;
  after: string;
  dropped: string;
}> {
  return turn.stages.flatMap((stage) =>
    stage.stage === "transform"
      ? [{ name: stage.name, reason: stage.reason, before: stage.before, after: stage.after, dropped: stage.dropped }]
      : [],
  );
}

export function callToFixture(call: VoiceCallTrace): VoiceFixture {
  return {
    schema: "scalers.voice.fixture",
    schemaVersion: 1,
    callId: call.callId,
    tenantId: call.tenantId,
    businessName: call.businessName,
    callerName: null,
    nameOnFile: false,
    source: "Saved from Quality. No database write.",
    turns: call.turns.map((turn) => {
      const output = lastStage(turn.stages, "model", "output");
      const request = lastStage(turn.stages, "model", "request");
      const canned = lastStage(turn.stages, "canned");
      const end = lastStage(turn.stages, "turn_end");
      const latency = lastStage(turn.stages, "latency");
      const outcome = lastStage(turn.stages, "outcome");
      const outputRow = output && output.stage === "model" && output.phase === "output" ? output : null;
      const requestRow = request && request.stage === "model" && request.phase === "request" ? request : null;
      const unlogged = outcome?.value === "unlogged";
      const fixture: VoiceFixtureTurn = {
        caller: turn.caller.text,
        flushed: end ? end.decision !== "hold" : true,
        model: {
          provider: outputRow?.provider || requestRow?.provider || null,
          model: outputRow?.model || requestRow?.model || null,
          promptId: outputRow?.promptId || requestRow?.promptId || null,
          outputText: unlogged ? null : (outputRow?.outputText ?? null),
          chars: outputRow?.chars ?? (outputRow?.outputText?.length || 0),
          spokenEmitted: outputRow?.spokenEmitted ?? null,
        },
      };
      if (canned) fixture.canned = { path: canned.path, text: canned.text };
      const pcm = latency?.callerStopToFirstTtsPcmMs;
      if (pcm != null) fixture.observed = { firstPcmMs: pcm };
      if (unlogged) fixture.unlogged = true;
      return fixture;
    }),
  };
}

const OFF_SCREEN_KEYS = new Set(["provider", "model", "voiceId", "sttModel", "ttsModel"]);

/** Stored stages for the Raw view, without vendor or model names. */
export function screenStages(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    return Object.fromEntries(Object.entries(row).filter(([key]) => !OFF_SCREEN_KEYS.has(key)));
  });
}
