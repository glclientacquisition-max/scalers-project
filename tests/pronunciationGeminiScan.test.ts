/**
 * Gemini Scan parse/validate + review-gate tests.
 * Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/pronunciationGeminiScan.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertApprovedForLexiconWrite,
  canAutoApplyProfileCandidate,
  candidateToLexiconEntry,
  countNewReviewRows,
  dismissalKey,
  extractJsonArrayText,
  issuesToCandidates,
  listenAddedCopy,
  listenWalkLimit,
  matchesProfileHint,
  mergeReviewQueue,
  parseGeminiScanIssues,
  partitionAutoApplyCandidates,
  REVIEW_QUEUE_MAX,
  scanCallsWithGemini,
  stampCandidateApproved,
  takeCallsWithRecordings,
  type PronunciationReviewCandidate,
} from "../dashboard/src/lib/pronunciationGeminiScan.ts";
import { GEMINI_SCAN_DEFAULT_BATCH } from "../dashboard/src/lib/pronunciationGeminiScanPrompt.ts";

describe("parseGeminiScanIssues", () => {
  it("accepts a clean JSON array", () => {
    const { issues, rejected } = parseGeminiScanIssues(
      JSON.stringify([
        {
          type: "AGENT_MISPRONUNCIATION",
          word_or_phrase: "Muindi Mbingu",
          timestamp_seconds: 12,
          confidence: "high",
          suggested_form: "Moo-in-dee Mbeen-goo",
          reasoning: "Place name sounded flattened.",
        },
      ])
    );
    assert.equal(rejected.length, 0);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].word_or_phrase, "Muindi Mbingu");
  });

  it("tolerates markdown fences and leading prose", () => {
    const raw = `Here you go:\n\`\`\`json\n[{"type":"LIKELY_MISHEARD","word_or_phrase":"Ruiru","timestamp_seconds":3,"confidence":"medium","suggested_form":"Ruiru","reasoning":"Agent answered about Ruaka."}]\n\`\`\``;
    const { issues } = parseGeminiScanIssues(raw);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].type, "LIKELY_MISHEARD");
  });

  it("rejects malformed / partial entries without throwing", () => {
    const { issues, rejected } = parseGeminiScanIssues(
      JSON.stringify([
        { type: "AGENT_MISPRONUNCIATION", word_or_phrase: "Aisha" },
        {
          type: "NOPE",
          word_or_phrase: "x",
          confidence: "high",
          suggested_form: "y",
          reasoning: "z",
        },
        {
          type: "AGENT_MISPRONUNCIATION",
          word_or_phrase: "Aisha",
          confidence: "high",
          suggested_form: "Eye-sha",
          reasoning: "ok",
        },
      ])
    );
    assert.equal(issues.length, 1);
    assert.ok(rejected.length >= 2);
  });

  it("drops a missing or provider reasoning instead of naming the model", () => {
    const { issues } = parseGeminiScanIssues(
      JSON.stringify([
        {
          type: "AGENT_MISPRONUNCIATION",
          word_or_phrase: "Aisha",
          confidence: "high",
          suggested_form: "Eye-sha",
        },
        {
          type: "AGENT_MISPRONUNCIATION",
          word_or_phrase: "Aisha",
          confidence: "medium",
          suggested_form: "Eye-sha",
          reasoning: "Flagged by Gemini Scan.",
        },
      ])
    );
    assert.equal(issues.length, 2);
    assert.equal(issues[0].reasoning, "");
    assert.equal(issues[1].reasoning, "");
    assert.doesNotMatch(issues.map((issue) => issue.reasoning).join(" "), /gemini/i);
  });

  it("handles empty array and non-json", () => {
    assert.equal(parseGeminiScanIssues("[]").issues.length, 0);
    assert.equal(parseGeminiScanIssues("not json").issues.length, 0);
    assert.equal(extractJsonArrayText("no array here"), null);
  });
});

describe("review gate", () => {
  it("blocks lexicon write without approved_by/approved_at", () => {
    const pending: PronunciationReviewCandidate = {
      id: "gemini_scan:c1:AGENT_MISPRONUNCIATION:aisha",
      source: "gemini_scan",
      type: "AGENT_MISPRONUNCIATION",
      word_or_phrase: "Aisha",
      suggested_form: "Eye-sha",
      confidence: "high",
      reasoning: "test",
      timestamp_seconds: 1,
      call_id: "c1",
      status: "pending",
      created_at: new Date().toISOString(),
    };
    const gate = assertApprovedForLexiconWrite(pending);
    assert.equal(gate.ok, false);
    assert.equal(candidateToLexiconEntry(pending), null);

    const approved = {
      ...pending,
      status: "approved" as const,
      approved_by: "user-1",
      approved_at: new Date().toISOString(),
    };
    assert.equal(assertApprovedForLexiconWrite(approved).ok, true);
    const entry = candidateToLexiconEntry(approved);
    assert.ok(entry);
    assert.match(entry!.say, /Eye-sha/i);
  });

  it("never writes LIKELY_MISHEARD to lexicon even if stamped approved", () => {
    const stt: PronunciationReviewCandidate = {
      id: "x",
      source: "gemini_scan",
      type: "LIKELY_MISHEARD",
      word_or_phrase: "Ruiru",
      suggested_form: "Ruiru",
      confidence: "high",
      reasoning: "test",
      timestamp_seconds: null,
      call_id: "c1",
      status: "approved",
      created_at: new Date().toISOString(),
      approved_by: "user-1",
      approved_at: new Date().toISOString(),
    };
    assert.equal(assertApprovedForLexiconWrite(stt).ok, false);
    assert.equal(candidateToLexiconEntry(stt), null);
  });

  it("keeps high-confidence profile names on review", () => {
    const hints = [
      "ChapterOne Bookstore",
      "Aisha",
      "Muindi Mbingu Street",
      "Harrison Maina",
    ];
    assert.equal(matchesProfileHint("Aisha", hints), true);
    assert.equal(matchesProfileHint("Muindi Mbingu", hints), true);
    assert.equal(matchesProfileHint("Random Brand", hints), false);

    const aisha: PronunciationReviewCandidate = {
      id: "g1",
      source: "gemini_scan",
      type: "AGENT_MISPRONUNCIATION",
      word_or_phrase: "Aisha",
      suggested_form: "Eye-sha",
      confidence: "high",
      reasoning: "ok",
      timestamp_seconds: 1,
      call_id: "c1",
      status: "pending",
      created_at: new Date().toISOString(),
    };
    const random: PronunciationReviewCandidate = {
      ...aisha,
      id: "g2",
      word_or_phrase: "Random Brand",
      suggested_form: "Ran-dom",
    };
    const medium: PronunciationReviewCandidate = {
      ...aisha,
      id: "g3",
      confidence: "medium",
    };

    assert.equal(canAutoApplyProfileCandidate(aisha, hints), false);
    assert.equal(canAutoApplyProfileCandidate(random, hints), false);
    assert.equal(canAutoApplyProfileCandidate(medium, hints), false);
    assert.equal(candidateToLexiconEntry(aisha), null);

    const { autoApply, pending } = partitionAutoApplyCandidates(
      [aisha, random, medium],
      hints
    );
    assert.equal(autoApply.length, 0);
    assert.equal(pending.length, 3);

    const stamped = stampCandidateApproved(aisha, {
      approvedBy: "owner-1",
      autoApplied: false,
    });
    assert.equal(stamped.auto_applied, false);
    assert.equal(assertApprovedForLexiconWrite(stamped).ok, true);
    assert.ok(candidateToLexiconEntry(stamped));
  });
});

describe("dismissals prevent recurrence", () => {
  it("skips rejected call+word on a subsequent scan", async () => {
    const callId = "call-abc";
    const raw = JSON.stringify([
      {
        type: "AGENT_MISPRONUNCIATION",
        word_or_phrase: "Muindi Mbingu",
        confidence: "high",
        suggested_form: "Moo-in-dee Mbeen-goo",
        reasoning: "again",
      },
    ]);

    const first = await scanCallsWithGemini({
      tenantId: "t1",
      calls: [{ id: callId, recording_url: "https://example.com/a.wav" }],
      lexiconExamples: [],
      dismissals: [],
      existingQueue: [],
      mockAnalyze: async () => ({ raw }),
    });
    assert.equal(first.candidates.length, 1);

    const key = dismissalKey(callId, "Muindi Mbingu", "AGENT_MISPRONUNCIATION");
    const second = await scanCallsWithGemini({
      tenantId: "t1",
      calls: [{ id: callId, recording_url: "https://example.com/a.wav" }],
      lexiconExamples: [],
      dismissals: [
        {
          key,
          call_id: callId,
          word_or_phrase: "Muindi Mbingu",
          type: "AGENT_MISPRONUNCIATION",
          status: "rejected",
          at: new Date().toISOString(),
        },
      ],
      existingQueue: [],
      mockAnalyze: async () => ({ raw }),
    });
    assert.equal(second.candidates.length, 0);
  });

  it("lands AGENT_MISPRONUNCIATION as pending only (not lexicon-ready)", () => {
    const created = issuesToCandidates({
      issues: [
        {
          type: "AGENT_MISPRONUNCIATION",
          word_or_phrase: "Aisha",
          confidence: "medium",
          suggested_form: "Eye-sha",
          reasoning: "Robotic stress.",
          timestamp_seconds: 2,
        },
      ],
      callId: "c9",
      dismissals: [],
      existingQueue: [],
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].status, "pending");
    assert.equal(created[0].source, "gemini_scan");
    assert.equal(created[0].approved_by, null);
    assert.equal(candidateToLexiconEntry(created[0]), null);

    const merged = mergeReviewQueue([], created);
    assert.equal(merged[0].status, "pending");
  });
});

function reviewRow(
  overrides: Partial<PronunciationReviewCandidate> = {}
): PronunciationReviewCandidate {
  return {
    id: "gemini_scan:c1:AGENT_MISPRONUNCIATION:aisha",
    source: "gemini_scan",
    type: "AGENT_MISPRONUNCIATION",
    word_or_phrase: "Aisha",
    suggested_form: "Eye-sha",
    confidence: "medium",
    reasoning: "Stress.",
    timestamp_seconds: 1,
    call_id: "c1",
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    approved_by: null,
    approved_at: null,
    ...overrides,
  };
}

describe("AI listen walk and result copy", () => {
  it("opens on Last 10", () => {
    assert.equal(GEMINI_SCAN_DEFAULT_BATCH, 10);
  });

  it("walks past calls with no recording until it has the requested count", () => {
    assert.equal(listenWalkLimit(10), 40);
    assert.equal(listenWalkLimit(20), 80);
    assert.equal(listenWalkLimit(50), 200);
    assert.equal(listenWalkLimit(80), 200);

    const calls = [
      { id: "1", recording_url: "" },
      { id: "2", recording_url: null },
      { id: "3", recording_url: "https://example.com/3.wav" },
      { id: "4", recording_url: " " },
      { id: "5", recording_url: "https://example.com/5.wav" },
      { id: "6", recording_url: "https://example.com/6.wav" },
    ];
    const picked = takeCallsWithRecordings(calls, 2);
    assert.deepEqual(
      picked.selected.map((call) => call.id),
      ["3", "5"]
    );
    assert.equal(picked.walked, 5);
  });

  it("reports new rows, not the waiting total", () => {
    assert.equal(listenAddedCopy(0), "Nothing new.");
    assert.equal(listenAddedCopy(3), "3 new.");
    assert.equal(listenAddedCopy(1), "1 new.");
  });
});

describe("merge the same name into one review row", () => {
  it("keeps the higher confidence and does not write the lexicon", () => {
    const low = reviewRow({
      id: "low",
      call_id: "c1",
      confidence: "low",
      suggested_form: "Ay-sha",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const high = reviewRow({
      id: "high",
      call_id: "c2",
      word_or_phrase: "AISHA",
      confidence: "high",
      suggested_form: "Eye-sha",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    const merged = mergeReviewQueue([low], [high]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confidence, "high");
    assert.equal(merged[0].suggested_form, "Eye-sha");
    assert.equal(merged[0].status, "pending");
    assert.equal(merged[0].approved_by ?? null, null);
    assert.equal(candidateToLexiconEntry(merged[0]), null);
    assert.equal(countNewReviewRows([low], merged), 0);
    assert.equal(listenAddedCopy(countNewReviewRows([low], merged)), "Nothing new.");
  });

  it("collapses the same name from two new calls into one new row", () => {
    const first = reviewRow({ id: "a", call_id: "c1", confidence: "medium" });
    const second = reviewRow({
      id: "b",
      call_id: "c2",
      word_or_phrase: "aisha",
      confidence: "high",
      suggested_form: "Eye-sha",
    });
    const merged = mergeReviewQueue([], [first, second]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].confidence, "high");
    assert.equal(countNewReviewRows([], merged), 1);
    assert.equal(candidateToLexiconEntry(merged[0]), null);
  });

  it("keeps the held say when confidence is equal", () => {
    const held = reviewRow({ suggested_form: "Eye-sha", confidence: "medium" });
    const incoming = reviewRow({
      id: "other",
      call_id: "c9",
      suggested_form: "Ay-sha",
      confidence: "medium",
    });
    const merged = mergeReviewQueue([held], [incoming]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].suggested_form, "Eye-sha");
    assert.equal(candidateToLexiconEntry(merged[0]), null);
  });

  it("keeps this listen's new names when the waiting list caps at 80, newest first", () => {
    // New names from this listen stay even when the list is already full.
    // Older rows fill the remaining slots, newest first.
    // If the new set itself is over 80, the newest new names stay.
    const older = Array.from({ length: REVIEW_QUEUE_MAX }, (_, i) =>
      reviewRow({
        id: `old-${i}`,
        call_id: `old-${i}`,
        word_or_phrase: `Oldname${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })
    );
    const fresh = [
      reviewRow({
        id: "new-a",
        call_id: "n1",
        word_or_phrase: "NewA",
        confidence: "high",
        created_at: "2026-06-01T00:00:01.000Z",
      }),
      reviewRow({
        id: "new-b",
        call_id: "n2",
        word_or_phrase: "NewB",
        confidence: "medium",
        created_at: "2026-06-01T00:00:02.000Z",
      }),
      reviewRow({
        id: "new-c",
        call_id: "n3",
        word_or_phrase: "NewC",
        confidence: "low",
        created_at: "2026-06-01T00:00:03.000Z",
      }),
    ];
    const merged = mergeReviewQueue(older, fresh);
    assert.equal(merged.length, REVIEW_QUEUE_MAX);
    const names = merged.map((row) => row.word_or_phrase.toLowerCase());
    assert.deepEqual(names.slice(0, 3), ["newc", "newb", "newa"]);
    assert.equal(names.includes("oldname0"), false);
    assert.equal(names.includes("oldname1"), false);
    assert.equal(names.includes("oldname2"), false);
    assert.equal(names.includes("oldname79"), true);

    const manyNew = Array.from({ length: REVIEW_QUEUE_MAX + 5 }, (_, i) =>
      reviewRow({
        id: `fresh-${i}`,
        call_id: `fresh-${i}`,
        word_or_phrase: `Fresh${i}`,
        created_at: new Date(Date.UTC(2026, 5, 1, 0, 0, i)).toISOString(),
      })
    );
    const cappedNew = mergeReviewQueue(older, manyNew);
    assert.equal(cappedNew.length, REVIEW_QUEUE_MAX);
    assert.equal(cappedNew[0].word_or_phrase, `Fresh${REVIEW_QUEUE_MAX + 4}`);
    assert.ok(cappedNew.every((row) => row.word_or_phrase.startsWith("Fresh")));
    assert.equal(candidateToLexiconEntry(cappedNew[0]), null);
  });
});
