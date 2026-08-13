"use server";

import { getAuthUser, isAuthenticated } from "@/lib/auth";
import {
  appendDismissal,
  appendScanLog,
  assertApprovedForLexiconWrite,
  candidateToLexiconEntry,
  clampScanBatchSize,
  dismissalKey,
  mergeReviewQueue,
  parseDismissals,
  parseReviewQueue,
  parseScanLogs,
  scanCallsWithGemini,
  type PronunciationReviewCandidate,
  type PronunciationScanDismissal,
} from "@/lib/pronunciationGeminiScan";
import {
  GEMINI_SCAN_MAX_BATCH,
} from "@/lib/pronunciationGeminiScanPrompt";
import {
  lexiconForStorage,
  mergeLexiconEntry,
  parseTtsLexicon,
} from "@/lib/pronunciationLexicon";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export type GeminiScanState = {
  error?: string;
  ok?: boolean;
  message?: string;
  candidates?: PronunciationReviewCandidate[];
  queue?: PronunciationReviewCandidate[];
  scannedCalls?: number;
  skippedCalls?: number;
  errors?: Array<{ call_id: string; error: string }>;
  /** Confirmation payload before a large batch runs. */
  needsConfirm?: boolean;
  estimatedCalls?: number;
  batchSize?: number;
};

export type GeminiScanQueueState = {
  error?: string;
  ok?: boolean;
  queue?: PronunciationReviewCandidate[];
  sttHints?: PronunciationReviewCandidate[];
  lexicon?: ReturnType<typeof parseTtsLexicon>;
  message?: string;
};

const scanHits = new Map<string, number[]>();

function rateLimitScan(tenantId: string): string | null {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const max = 6;
  const prev = (scanHits.get(tenantId) || []).filter((t) => now - t < windowMs);
  if (prev.length >= max) {
    return "Gemini Scan rate limit — wait a few minutes, or review the queue you already have.";
  }
  prev.push(now);
  scanHits.set(tenantId, prev);
  return null;
}

function tenantQueueFields(tenant: Record<string, unknown>) {
  return {
    queue: parseReviewQueue(tenant.pronunciation_review_queue),
    dismissals: parseDismissals(tenant.pronunciation_scan_dismissals),
    logs: parseScanLogs(tenant.pronunciation_gemini_scan_logs),
  };
}

async function persistQueueFields(opts: {
  tenantId: string;
  queue: PronunciationReviewCandidate[];
  dismissals?: PronunciationScanDismissal[];
  logs?: ReturnType<typeof parseScanLogs>;
}): Promise<string | null> {
  const workspace = await createWorkspaceDataClient();
  if (!workspace) return "Not signed in.";
  const patch: Record<string, unknown> = {
    pronunciation_review_queue: opts.queue,
  };
  if (opts.dismissals) {
    patch.pronunciation_scan_dismissals = opts.dismissals;
  }
  if (opts.logs) {
    patch.pronunciation_gemini_scan_logs = opts.logs;
  }
  const { error } = await workspace.client
    .from("tenants")
    .update(patch)
    .eq("id", opts.tenantId);
  if (error) {
    if (/pronunciation_review_queue|pronunciation_scan/i.test(error.message)) {
      return `${error.message} Apply docs/supabase/pronunciation_gemini_scan.sql in Supabase.`;
    }
    return error.message;
  }
  return null;
}

/** Load pending Gemini / review candidates for the Fix tab. */
export async function loadPronunciationReviewQueueAction(
  _prev: GeminiScanQueueState,
  formData: FormData
): Promise<GeminiScanQueueState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to load review queue." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) return { error: "Forbidden." };

  const { queue } = tenantQueueFields(tenant as Record<string, unknown>);
  const pending = queue.filter((c) => c.status === "pending");
  return {
    ok: true,
    queue: pending.filter((c) => c.type === "AGENT_MISPRONUNCIATION"),
    sttHints: pending.filter((c) => c.type === "LIKELY_MISHEARD"),
  };
}

/**
 * Preview / run Gemini Scan over recent call recordings.
 * Never writes tts_lexicon — only appends pending review candidates.
 */
export async function geminiScanRecentCallsAction(
  _prev: GeminiScanState,
  formData: FormData
): Promise<GeminiScanState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to run Gemini Scan." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };

  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) return { error: "Forbidden." };

  const batchSize = clampScanBatchSize(formData.get("batch_size"));
  if (batchSize > GEMINI_SCAN_MAX_BATCH) {
    return { error: `Max ${GEMINI_SCAN_MAX_BATCH} calls per scan.` };
  }

  const confirmed = String(formData.get("confirmed") || "") === "1";
  // Cost guard: batches over 10 need an explicit confirm step.
  if (batchSize > 10 && !confirmed) {
    return {
      ok: true,
      needsConfirm: true,
      estimatedCalls: batchSize,
      batchSize,
      message: `Gemini will listen to up to ${batchSize} recent recordings (paid API). Confirm to continue.`,
    };
  }

  const limited = rateLimitScan(tenant.id);
  if (limited) return { error: limited };

  if (!process.env.GEMINI_API_KEY) {
    return {
      error:
        "GEMINI_API_KEY is not configured on this desk host — Gemini Scan cannot run.",
    };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const { data: calls, error: callErr } = await workspace.client
    .from("calls")
    .select("id, recording_url")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })
    .limit(batchSize);

  if (callErr) return { error: callErr.message };

  const withRecording = (calls || []).filter((c) =>
    String((c as { recording_url?: string }).recording_url || "").trim()
  );
  if (!withRecording.length) {
    return {
      ok: true,
      candidates: [],
      scannedCalls: 0,
      skippedCalls: (calls || []).length,
      message:
        "No recent calls with recordings to listen to. Heuristic Scan recent calls still works on transcripts.",
    };
  }

  const fields = tenantQueueFields(tenant as Record<string, unknown>);
  const lexicon = parseTtsLexicon(
    formData.get("current_lexicon") ??
      (tenant as { tts_lexicon?: unknown }).tts_lexicon
  );

  let result: Awaited<ReturnType<typeof scanCallsWithGemini>>;
  try {
    result = await scanCallsWithGemini({
      tenantId: tenant.id,
      calls: withRecording.map((c) => ({
        id: String((c as { id: string }).id),
        recording_url: String(
          (c as { recording_url?: string }).recording_url || ""
        ),
      })),
      lexiconExamples: lexicon,
      dismissals: fields.dismissals,
      existingQueue: fields.queue,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error
          ? `Gemini Scan failed: ${err.message}`
          : "Gemini Scan failed.",
    };
  }

  const nextQueue = mergeReviewQueue(fields.queue, result.candidates);
  const nextLogs = appendScanLog(fields.logs, result.log);
  console.info(
    "[gemini-scan]",
    JSON.stringify({
      tenant: tenant.id,
      callIds: result.log.call_ids,
      candidates: result.candidates.length,
      errors: result.errors.length,
      at: result.log.at,
    })
  );

  const persistError = await persistQueueFields({
    tenantId: tenant.id,
    queue: nextQueue,
    logs: nextLogs,
  });
  if (persistError) return { error: persistError };

  const pending = nextQueue.filter((c) => c.status === "pending");
  return {
    ok: true,
    candidates: result.candidates,
    queue: pending,
    scannedCalls: withRecording.length,
    skippedCalls: (calls || []).length - withRecording.length,
    errors: result.errors,
    message:
      result.candidates.length > 0
        ? `Added ${result.candidates.length} AI suggestion(s) for review.`
        : "Scan finished — no new high-confidence issues.",
  };
}

export async function approveGeminiScanCandidateAction(
  _prev: GeminiScanQueueState,
  formData: FormData
): Promise<GeminiScanQueueState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to approve." };
  }
  const user = await getAuthUser();
  if (!user?.id) return { error: "Sign in to approve." };

  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) return { error: "Forbidden." };

  const candidateId = String(formData.get("candidate_id") || "").trim();
  const editedSay = String(formData.get("edited_say") || "").trim();
  if (!candidateId) return { error: "Missing candidate." };

  const fields = tenantQueueFields(tenant as Record<string, unknown>);
  const idx = fields.queue.findIndex((c) => c.id === candidateId);
  if (idx < 0) return { error: "Candidate not found (maybe already reviewed)." };
  const candidate = { ...fields.queue[idx] };

  if (candidate.source === "gemini_scan" && candidate.status === "pending") {
    // Human approval stamp — required before any lexicon write.
    candidate.status = "approved";
    candidate.approved_by = user.id;
    candidate.approved_at = new Date().toISOString();
    if (editedSay) candidate.edited_say = editedSay;
  } else if (candidate.status !== "approved") {
    return { error: "Only pending suggestions can be approved." };
  }

  const gate = assertApprovedForLexiconWrite(candidate);
  if (!gate.ok) {
    // LIKELY_MISHEARD: acknowledge/remove from queue without lexicon write.
    if (candidate.type === "LIKELY_MISHEARD") {
      const nextQueue = fields.queue.filter((c) => c.id !== candidateId);
      const dismissals = appendDismissal(fields.dismissals, {
        key: dismissalKey(
          candidate.call_id,
          candidate.word_or_phrase,
          candidate.type
        ),
        call_id: candidate.call_id,
        word_or_phrase: candidate.word_or_phrase,
        type: candidate.type,
        status: "rejected",
        at: new Date().toISOString(),
      });
      const persistError = await persistQueueFields({
        tenantId: tenant.id,
        queue: nextQueue,
        dismissals,
      });
      if (persistError) return { error: persistError };
      const pending = nextQueue.filter((c) => c.status === "pending");
      return {
        ok: true,
        message:
          "Dismissed STT hint (not written to pronunciation lexicon).",
        queue: pending.filter((c) => c.type === "AGENT_MISPRONUNCIATION"),
        sttHints: pending.filter((c) => c.type === "LIKELY_MISHEARD"),
      };
    }
    return { error: gate.error };
  }

  const entry = candidateToLexiconEntry(candidate);
  if (!entry) {
    return {
      error:
        "Could not build a safe lexicon entry (blocked common word or empty say-as).",
    };
  }

  const existing = parseTtsLexicon(
    (tenant as { tts_lexicon?: unknown }).tts_lexicon
  );
  const clientLexicon = parseTtsLexicon(formData.get("current_lexicon"));
  const base = clientLexicon.length ? clientLexicon : existing;
  const merged = parseTtsLexicon(mergeLexiconEntry(base, entry));
  const stored = lexiconForStorage(merged);

  const workspace = await createWorkspaceDataClient();
  if (!workspace) return { error: "Not signed in." };

  const nextQueue = fields.queue.filter((c) => c.id !== candidateId);
  const { error } = await workspace.client
    .from("tenants")
    .update({
      tts_lexicon: stored,
      pronunciation_review_queue: nextQueue,
    })
    .eq("id", tenant.id);

  if (error) {
    return { error: error.message };
  }

  const pending = nextQueue.filter((c) => c.status === "pending");
  return {
    ok: true,
    message: "Approved — live pronunciation updated for the next call.",
    lexicon: merged,
    queue: pending.filter((c) => c.type === "AGENT_MISPRONUNCIATION"),
    sttHints: pending.filter((c) => c.type === "LIKELY_MISHEARD"),
  };
}

export async function dismissGeminiScanCandidateAction(
  _prev: GeminiScanQueueState,
  formData: FormData
): Promise<GeminiScanQueueState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to dismiss." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) return { error: "Forbidden." };

  const candidateId = String(formData.get("candidate_id") || "").trim();
  const mode =
    String(formData.get("mode") || "rejected").trim() === "snoozed"
      ? "snoozed"
      : "rejected";
  if (!candidateId) return { error: "Missing candidate." };

  const fields = tenantQueueFields(tenant as Record<string, unknown>);
  const candidate = fields.queue.find((c) => c.id === candidateId);
  if (!candidate) return { error: "Candidate not found." };

  const nextQueue = fields.queue.filter((c) => c.id !== candidateId);
  const dismissals = appendDismissal(fields.dismissals, {
    key: dismissalKey(
      candidate.call_id,
      candidate.word_or_phrase,
      candidate.type
    ),
    call_id: candidate.call_id,
    word_or_phrase: candidate.word_or_phrase,
    type: candidate.type,
    status: mode,
    at: new Date().toISOString(),
  });

  const persistError = await persistQueueFields({
    tenantId: tenant.id,
    queue: nextQueue,
    dismissals,
  });
  if (persistError) return { error: persistError };

  const pending = nextQueue.filter((c) => c.status === "pending");
  return {
    ok: true,
    message: mode === "snoozed" ? "Snoozed for later scans." : "Rejected.",
    queue: pending.filter((c) => c.type === "AGENT_MISPRONUNCIATION"),
    sttHints: pending.filter((c) => c.type === "LIKELY_MISHEARD"),
  };
}

/**
 * Queue an approved-path recording practice line from a Gemini candidate
 * without writing the AI phonetic guess to the live lexicon.
 */
export async function queueGeminiCandidateForRecordingAction(
  _prev: GeminiScanQueueState,
  formData: FormData
): Promise<GeminiScanQueueState & { practicePrompt?: string; practicePhrase?: string }> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in first." };
  }
  const tenant = await getCurrentTenant();
  if (!tenant) return { error: "No workspace linked to this account." };
  const id = String(formData.get("id") || "").trim();
  if (!id || id !== tenant.id) return { error: "Forbidden." };

  const candidateId = String(formData.get("candidate_id") || "").trim();
  const fields = tenantQueueFields(tenant as Record<string, unknown>);
  const candidate = fields.queue.find((c) => c.id === candidateId);
  if (!candidate) return { error: "Candidate not found." };
  if (candidate.type !== "AGENT_MISPRONUNCIATION") {
    return { error: "Only mispronunciation items can be recorded." };
  }

  return {
    ok: true,
    practicePhrase: candidate.word_or_phrase,
    practicePrompt: `You can ask for ${candidate.word_or_phrase}.`,
    queue: fields.queue.filter(
      (c) => c.status === "pending" && c.type === "AGENT_MISPRONUNCIATION"
    ),
    sttHints: fields.queue.filter(
      (c) => c.status === "pending" && c.type === "LIKELY_MISHEARD"
    ),
    message:
      "Queued for Practice — record real audio (more reliable than the AI phonetic guess).",
  };
}
