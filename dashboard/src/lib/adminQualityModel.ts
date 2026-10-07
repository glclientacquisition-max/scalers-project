/**
 * Voice quality view model for Super Admin.
 * Shape follows trace schema v1 (`scalers.voice.turn` / `scalers.voice.call`)
 * plus the fields Platform still has to persist: call score, per-check counts,
 * diagnosis, release, and per-turn check hits. Business rows add `dropping`
 * and `droppingReason`.
 *
 * Reads live in `adminQuality.ts` (server-only). This file is pure so the
 * desk, the dev harness, and tests can share it.
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

const CHECK_LABELS: Record<VoiceCheckName, string> = {
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
  caller: { text: string; language: string; confidence: number | null };
  stages: VoiceStage[];
  /**
   * Per-turn check hits. Not a column on schema v1. Platform fills this from
   * the scorer so the timeline can pin a failing check without rescoring.
   */
  checks: VoiceCheckCounts;
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
  checks: VoiceCheckCounts;
  /** Persisted one-line read. Null until the scorer stores one. */
  diagnosis: string | null;
  release: VoiceRelease | null;
};

export type BusinessQualityRow = {
  businessId: string;
  name: string;
  score: number | null;
  /** Oldest to newest scores inside the selected range. */
  trend: number[];
  topFailure: VoiceCheckName | null;
  dropping: boolean;
  droppingReason: string;
  callsTraced: number;
  lastCallAt: string | null;
};

export type QualityCallSummary = {
  callId: string;
  score: number | null;
  checks: VoiceCheckCounts;
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
  model: {
    provider: string;
    model: string;
    promptId: string;
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

export function failingChecks(checks: VoiceCheckCounts): VoiceCheckName[] {
  return CHECK_SEVERITY.filter((check) => (checks[check] || 0) > 0);
}

export function topCheck(checks: VoiceCheckCounts): VoiceCheckName | null {
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

/** Persisted diagnosis, or the top check in plain words when that is null. */
export function diagnosisLine(call: { diagnosis: string | null; checks: VoiceCheckCounts }): string {
  const stored = call.diagnosis?.trim() || "";
  if (stored) return stored;
  const top = topCheck(call.checks);
  return top ? checkLabel(top) : "No failing checks";
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

export function shortSha(sha: string): string {
  const clean = sha.trim();
  if (!clean) return "Not logged";
  return clean.length <= 7 ? clean : clean.slice(0, 7);
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

function turnMissed(turn: VoiceTurnTrace): boolean {
  if ((turn.checks.incomplete || 0) > 0) return true;
  if ((turn.checks.silence || 0) > 0) return true;
  if ((turn.checks.deletedAnswer || 0) > 0) return true;
  for (const stage of turn.stages) {
    if (stage.stage === "canned" && stage.path === "llm_recovery") return true;
    if (stage.stage === "outcome") {
      const value = stage.value.trim().toLowerCase();
      if (value === "unknown" || value === "escalation") return true;
    }
  }
  return false;
}

/**
 * Caller questions from turns that failed incomplete, silence, or deleted
 * answer, used the recovery line, or closed UNKNOWN / escalation.
 * Deduped by the caller question.
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
export function repeatFailuresFromCalls(calls: readonly { checks: VoiceCheckCounts }[]): RepeatFailure[] {
  const hits = emptyChecks();
  for (const call of calls) {
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
  if (!row) return "Not logged";
  return `Detected ${row.detected}. Sticky ${row.sticky}.`;
}

export function geminiRaw(turn: VoiceTurnTrace): string | null {
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
          provider: outputRow?.provider || requestRow?.provider || (canned ? "canned" : "gemini"),
          model: outputRow?.model || requestRow?.model || canned?.path || "recorded",
          promptId: outputRow?.promptId || requestRow?.promptId || "voice.system",
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
