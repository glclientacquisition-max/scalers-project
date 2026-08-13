/**
 * Gemini Scan — listen to call recordings and draft Fix-queue candidates.
 * Never writes live tts_lexicon; human approve is mandatory.
 */

import {
  generateGeminiMultimodal,
  normalizeAudioMimeForGemini,
  type GeminiPart,
} from "@/lib/gemini";
import {
  isBlockedMatch,
  matchPatternFromPhrase,
  sanitizeSayForm,
  type TtsLexiconEntry,
} from "@/lib/pronunciationLexicon";
import {
  GEMINI_CALL_PRONUNCIATION_SCAN_SYSTEM,
  GEMINI_SCAN_DEFAULT_BATCH,
  GEMINI_SCAN_MAX_BATCH,
  GEMINI_SCAN_MAX_INLINE_AUDIO_BYTES,
} from "@/lib/pronunciationGeminiScanPrompt";

export type GeminiScanIssueType =
  | "AGENT_MISPRONUNCIATION"
  | "LIKELY_MISHEARD";

export type GeminiScanConfidence = "high" | "medium" | "low";

export type GeminiScanCandidateSource = "manual" | "gemini_scan";

export type GeminiScanCandidateStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "snoozed";

export type GeminiScanRawIssue = {
  type: GeminiScanIssueType;
  word_or_phrase: string;
  timestamp_seconds?: number | null;
  confidence: GeminiScanConfidence;
  suggested_fix: string;
  reasoning: string;
};

export type PronunciationReviewCandidate = {
  id: string;
  source: GeminiScanCandidateSource;
  type: GeminiScanIssueType;
  word_or_phrase: string;
  suggested_form: string;
  confidence: GeminiScanConfidence;
  reasoning: string;
  timestamp_seconds: number | null;
  call_id: string;
  status: GeminiScanCandidateStatus;
  created_at: string;
  /** Set only by a real human approve action — required before lexicon write. */
  approved_by?: string | null;
  approved_at?: string | null;
  /** Edited say-as before approve (AGENT_MISPRONUNCIATION only). */
  edited_say?: string | null;
};

export type PronunciationScanDismissal = {
  key: string;
  call_id: string;
  word_or_phrase: string;
  type: GeminiScanIssueType;
  status: "rejected" | "snoozed";
  at: string;
};

export type PronunciationGeminiScanLog = {
  at: string;
  tenant_id: string;
  call_ids: string[];
  candidates_returned: number;
  raw_outputs: Array<{ call_id: string; raw: string; error?: string }>;
  cost?: unknown;
};

const QUEUE_MAX = 80;
const DISMISS_MAX = 200;
const LOG_MAX = 10;

export function dismissalKey(
  callId: string,
  wordOrPhrase: string,
  type: GeminiScanIssueType
): string {
  return `${String(callId)}::${String(type)}::${String(wordOrPhrase)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()}`;
}

export function clampScanBatchSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return GEMINI_SCAN_DEFAULT_BATCH;
  return Math.min(GEMINI_SCAN_MAX_BATCH, Math.max(1, Math.floor(n)));
}

/** Extract a JSON array from model text (tolerates fences / leading prose). */
export function extractJsonArrayText(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  if (text.startsWith("[")) {
    const end = text.lastIndexOf("]");
    if (end >= 0) return text.slice(0, end + 1);
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = fenced[1].trim();
    const start = inner.indexOf("[");
    const end = inner.lastIndexOf("]");
    if (start >= 0 && end > start) return inner.slice(start, end + 1);
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return null;
}

export function parseGeminiScanIssues(raw: string): {
  issues: GeminiScanRawIssue[];
  rejected: Array<{ reason: string; item?: unknown }>;
} {
  const rejected: Array<{ reason: string; item?: unknown }> = [];
  const jsonText = extractJsonArrayText(raw);
  if (!jsonText) {
    return {
      issues: [],
      rejected: [{ reason: "no_json_array", item: String(raw || "").slice(0, 200) }],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      issues: [],
      rejected: [{ reason: "json_parse_error", item: jsonText.slice(0, 200) }],
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      issues: [],
      rejected: [{ reason: "not_an_array", item: parsed }],
    };
  }

  const issues: GeminiScanRawIssue[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") {
      rejected.push({ reason: "not_object", item });
      continue;
    }
    const row = item as Record<string, unknown>;
    const type = String(row.type || "").trim().toUpperCase();
    if (type !== "AGENT_MISPRONUNCIATION" && type !== "LIKELY_MISHEARD") {
      rejected.push({ reason: "bad_type", item });
      continue;
    }
    const word = String(row.word_or_phrase || "").trim();
    const suggested = String(row.suggested_form || "").trim();
    const confidence = String(row.confidence || "")
      .trim()
      .toLowerCase();
    if (!word || !suggested) {
      rejected.push({ reason: "missing_fields", item });
      continue;
    }
    if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
      rejected.push({ reason: "bad_confidence", item });
      continue;
    }
    const reasoning = String(row.reasoning || "").trim() || "Flagged by Gemini Scan.";
    let timestamp: number | null = null;
    if (row.timestamp_seconds != null && row.timestamp_seconds !== "") {
      const n = Number(row.timestamp_seconds);
      if (Number.isFinite(n) && n >= 0) timestamp = n;
    }
    issues.push({
      type: type as GeminiScanIssueType,
      word_or_phrase: word.slice(0, 120),
      suggested_form: suggested.slice(0, 160),
      confidence: confidence as GeminiScanConfidence,
      reasoning: reasoning.slice(0, 280),
      timestamp_seconds: timestamp,
    });
  }

  return { issues, rejected };
}

export function parseReviewQueue(raw: unknown): PronunciationReviewCandidate[] {
  if (raw == null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: PronunciationReviewCandidate[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id || "").trim();
    const source =
      row.source === "manual" || row.source === "gemini_scan"
        ? row.source
        : null;
    const type =
      row.type === "AGENT_MISPRONUNCIATION" || row.type === "LIKELY_MISHEARD"
        ? row.type
        : null;
    const status =
      row.status === "pending" ||
      row.status === "approved" ||
      row.status === "rejected" ||
      row.status === "snoozed"
        ? row.status
        : null;
    const confidence =
      row.confidence === "high" ||
      row.confidence === "medium" ||
      row.confidence === "low"
        ? row.confidence
        : null;
    const word = String(row.word_or_phrase || "").trim();
    const suggested = String(row.suggested_form || "").trim();
    const callId = String(row.call_id || "").trim();
    if (!id || !source || !type || !status || !confidence || !word || !suggested || !callId) {
      continue;
    }
    out.push({
      id,
      source,
      type,
      word_or_phrase: word,
      suggested_form: suggested,
      confidence,
      reasoning: String(row.reasoning || "").trim().slice(0, 280),
      timestamp_seconds:
        row.timestamp_seconds == null || row.timestamp_seconds === ""
          ? null
          : Number(row.timestamp_seconds),
      call_id: callId,
      status,
      created_at: String(row.created_at || new Date().toISOString()),
      approved_by:
        row.approved_by == null ? null : String(row.approved_by),
      approved_at:
        row.approved_at == null ? null : String(row.approved_at),
      edited_say: row.edited_say == null ? null : String(row.edited_say),
    });
  }
  return out.slice(0, QUEUE_MAX);
}

export function parseDismissals(raw: unknown): PronunciationScanDismissal[] {
  if (raw == null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const key = String(row.key || "").trim();
      const call_id = String(row.call_id || "").trim();
      const word_or_phrase = String(row.word_or_phrase || "").trim();
      const type =
        row.type === "AGENT_MISPRONUNCIATION" || row.type === "LIKELY_MISHEARD"
          ? row.type
          : null;
      const status =
        row.status === "rejected" || row.status === "snoozed" ? row.status : null;
      if (!key || !call_id || !word_or_phrase || !type || !status) return null;
      return {
        key,
        call_id,
        word_or_phrase,
        type,
        status,
        at: String(row.at || new Date().toISOString()),
      } satisfies PronunciationScanDismissal;
    })
    .filter(Boolean)
    .slice(0, DISMISS_MAX) as PronunciationScanDismissal[];
}

export function parseScanLogs(raw: unknown): PronunciationGeminiScanLog[] {
  if (raw == null || raw === "") return [];
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, LOG_MAX) as PronunciationGeminiScanLog[];
}

/**
 * Hard product rule: gemini_scan candidates cannot enter the live lexicon
 * unless a human approve action set approved_by + approved_at.
 */
export function assertApprovedForLexiconWrite(
  candidate: PronunciationReviewCandidate
): { ok: true } | { ok: false; error: string } {
  if (candidate.source !== "gemini_scan" && candidate.source !== "manual") {
    return { ok: false, error: "Unknown candidate source." };
  }
  if (candidate.type !== "AGENT_MISPRONUNCIATION") {
    return {
      ok: false,
      error:
        "LIKELY_MISHEARD items are STT hints — they never write to tts_lexicon.",
    };
  }
  if (candidate.status !== "approved") {
    return {
      ok: false,
      error: "Candidate must be approved by a human before lexicon write.",
    };
  }
  if (!candidate.approved_by || !candidate.approved_at) {
    return {
      ok: false,
      error:
        "Missing approved_by/approved_at — gemini_scan suggestions cannot auto-apply.",
    };
  }
  return { ok: true };
}

export function candidateToLexiconEntry(
  candidate: PronunciationReviewCandidate
): TtsLexiconEntry | null {
  const gate = assertApprovedForLexiconWrite(candidate);
  if (!gate.ok) return null;
  const phrase = candidate.word_or_phrase.trim();
  const match = matchPatternFromPhrase(phrase);
  if (!match || isBlockedMatch(match)) return null;
  const say = sanitizeSayForm(
    String(candidate.edited_say || candidate.suggested_form || "").trim()
  );
  if (!say) return null;
  return {
    match,
    say,
    langs: ["en", "sw", "sheng"],
    priority: 200,
    label: phrase.slice(0, 120),
  };
}

export function formatFewShotLexiconExamples(
  lexicon: TtsLexiconEntry[],
  limit = 5
): string {
  const rows = (lexicon || [])
    .filter((e) => e.match && e.say)
    .slice(0, limit)
    .map(
      (e) =>
        `- "${e.label || e.match}" → say like "${e.say}"`
    );
  if (!rows.length) {
    return `- "Aisha" → say like "Eye-sha"
- "Muindi Mbingu" → say like "Moo-in-dee Mbeen-goo"
- "ChapterOne" → say like "Chapter One"`;
  }
  return rows.join("\n");
}

export function issuesToCandidates(opts: {
  issues: GeminiScanRawIssue[];
  callId: string;
  dismissals: PronunciationScanDismissal[];
  existingQueue: PronunciationReviewCandidate[];
}): PronunciationReviewCandidate[] {
  const dismissed = new Set(opts.dismissals.map((d) => d.key));
  const existingKeys = new Set(
    opts.existingQueue.map((c) =>
      dismissalKey(c.call_id, c.word_or_phrase, c.type)
    )
  );
  const out: PronunciationReviewCandidate[] = [];
  const now = new Date().toISOString();
  for (const issue of opts.issues) {
    const key = dismissalKey(opts.callId, issue.word_or_phrase, issue.type);
    if (dismissed.has(key) || existingKeys.has(key)) continue;
    if (issue.type === "AGENT_MISPRONUNCIATION") {
      const match = matchPatternFromPhrase(issue.word_or_phrase);
      if (!match || isBlockedMatch(match)) continue;
    }
    const id = `gemini_scan:${opts.callId}:${issue.type}:${issue.word_or_phrase}`
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, "-")
      .slice(0, 120);
    out.push({
      id,
      source: "gemini_scan",
      type: issue.type,
      word_or_phrase: issue.word_or_phrase,
      suggested_form: issue.suggested_form,
      confidence: issue.confidence,
      reasoning: issue.reasoning,
      timestamp_seconds: issue.timestamp_seconds ?? null,
      call_id: opts.callId,
      status: "pending",
      created_at: now,
      approved_by: null,
      approved_at: null,
    });
    existingKeys.add(key);
  }
  return out;
}

export function mergeReviewQueue(
  existing: PronunciationReviewCandidate[],
  incoming: PronunciationReviewCandidate[]
): PronunciationReviewCandidate[] {
  const byId = new Map<string, PronunciationReviewCandidate>();
  for (const c of existing) byId.set(c.id, c);
  for (const c of incoming) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  return [...byId.values()]
    .filter((c) => c.status === "pending")
    .slice(0, QUEUE_MAX);
}

export function appendScanLog(
  existing: PronunciationGeminiScanLog[],
  next: PronunciationGeminiScanLog
): PronunciationGeminiScanLog[] {
  return [next, ...existing].slice(0, LOG_MAX);
}

export function appendDismissal(
  existing: PronunciationScanDismissal[],
  next: PronunciationScanDismissal
): PronunciationScanDismissal[] {
  const filtered = existing.filter((d) => d.key !== next.key);
  return [next, ...filtered].slice(0, DISMISS_MAX);
}

function guessMimeFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3")) return "audio/mpeg";
  if (lower.includes(".wav")) return "audio/wav";
  if (lower.includes(".ogg")) return "audio/ogg";
  if (lower.includes(".m4a") || lower.includes(".mp4")) return "audio/mp4";
  if (lower.includes(".webm")) return "audio/webm";
  return "audio/mpeg";
}

export async function fetchCallRecordingAudio(recordingUrl: string): Promise<{
  ok: true;
  base64: string;
  mimeType: string;
  bytes: number;
} | {
  ok: false;
  error: string;
}> {
  const url = String(recordingUrl || "").trim();
  if (!url) return { ok: false, error: "missing_recording_url" };
  let res: Response;
  try {
    res = await fetch(url, { method: "GET" });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "fetch_failed",
    };
  }
  if (!res.ok) {
    return { ok: false, error: `http_${res.status}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return { ok: false, error: "empty_audio" };
  if (buf.length > GEMINI_SCAN_MAX_INLINE_AUDIO_BYTES) {
    return {
      ok: false,
      error: `audio_too_large_${buf.length}`,
    };
  }
  const headerMime = normalizeAudioMimeForGemini(
    res.headers.get("content-type") || guessMimeFromUrl(url)
  );
  return {
    ok: true,
    base64: buf.toString("base64"),
    mimeType: headerMime,
    bytes: buf.length,
  };
}

/**
 * Core job: scan one or more calls with Gemini audio understanding.
 * Returns draft candidates only — does not touch tts_lexicon.
 */
export async function scanCallsWithGemini(opts: {
  tenantId: string;
  calls: Array<{ id: string; recording_url?: string | null }>;
  lexiconExamples: TtsLexiconEntry[];
  dismissals: PronunciationScanDismissal[];
  existingQueue: PronunciationReviewCandidate[];
  /** Injected for tests — when set, skips network Gemini + audio fetch. */
  mockAnalyze?: (args: {
    callId: string;
    recordingUrl: string;
  }) => Promise<{ raw: string; cost?: unknown }>;
}): Promise<{
  candidates: PronunciationReviewCandidate[];
  log: PronunciationGeminiScanLog;
  errors: Array<{ call_id: string; error: string }>;
}> {
  const callIds = opts.calls.map((c) => c.id).filter(Boolean);
  const rawOutputs: PronunciationGeminiScanLog["raw_outputs"] = [];
  const errors: Array<{ call_id: string; error: string }> = [];
  let queue = [...opts.existingQueue];
  const allNew: PronunciationReviewCandidate[] = [];
  const fewShot = formatFewShotLexiconExamples(opts.lexiconExamples);
  let lastCost: unknown;

  for (const call of opts.calls) {
    const recordingUrl = String(call.recording_url || "").trim();
    if (!recordingUrl) {
      errors.push({ call_id: call.id, error: "no_recording" });
      rawOutputs.push({
        call_id: call.id,
        raw: "",
        error: "no_recording",
      });
      continue;
    }

    try {
      let raw: string;
      if (opts.mockAnalyze) {
        const mocked = await opts.mockAnalyze({
          callId: call.id,
          recordingUrl,
        });
        raw = mocked.raw;
        if (mocked.cost != null) lastCost = mocked.cost;
      } else {
        const audio = await fetchCallRecordingAudio(recordingUrl);
        if (!audio.ok) {
          errors.push({ call_id: call.id, error: audio.error });
          rawOutputs.push({
            call_id: call.id,
            raw: "",
            error: audio.error,
          });
          continue;
        }
        const userText = `Approved Library say-as style examples (match this style for AGENT_MISPRONUNCIATION suggested_form):
${fewShot}

Call id: ${call.id}
Listen to the attached phone-call recording and return the JSON array described in the system instruction.`;
        const parts: GeminiPart[] = [
          { text: userText },
          {
            inlineData: {
              mimeType: audio.mimeType,
              data: audio.base64,
            },
          },
        ];
        raw = await generateGeminiMultimodal({
          systemInstruction: GEMINI_CALL_PRONUNCIATION_SCAN_SYSTEM,
          parts,
          temperature: 0.2,
          maxOutputTokens: 2048,
          timeoutMs: 55_000,
        });
      }

      rawOutputs.push({ call_id: call.id, raw: String(raw || "").slice(0, 8000) });
      const { issues } = parseGeminiScanIssues(raw);
      const created = issuesToCandidates({
        issues,
        callId: call.id,
        dismissals: opts.dismissals,
        existingQueue: queue,
      });
      allNew.push(...created);
      queue = mergeReviewQueue(queue, created);
    } catch (err) {
      const message = err instanceof Error ? err.message : "scan_failed";
      errors.push({ call_id: call.id, error: message });
      rawOutputs.push({ call_id: call.id, raw: "", error: message });
    }
  }

  const log: PronunciationGeminiScanLog = {
    at: new Date().toISOString(),
    tenant_id: opts.tenantId,
    call_ids: callIds,
    candidates_returned: allNew.length,
    raw_outputs: rawOutputs,
    cost: lastCost,
  };

  return { candidates: allNew, log, errors };
}
