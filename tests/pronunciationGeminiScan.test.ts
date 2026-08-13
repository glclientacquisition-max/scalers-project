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
  dismissalKey,
  extractJsonArrayText,
  issuesToCandidates,
  matchesProfileHint,
  mergeReviewQueue,
  parseGeminiScanIssues,
  partitionAutoApplyCandidates,
  scanCallsWithGemini,
  stampCandidateApproved,
  type PronunciationReviewCandidate,
} from "../dashboard/src/lib/pronunciationGeminiScan.ts";

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

  it("handles empty array and non-json", () => {
    assert.equal(parseGeminiScanIssues("[]").issues.length, 0);
    assert.equal(parseGeminiScanIssues("not json").issues.length, 0);
    assert.equal(extractJsonArrayText("no array here"), null);
  });
});

describe("review gate + safe profile auto-apply", () => {
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

  it("auto-applies only high-confidence profile-name speech fixes", () => {
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

    assert.equal(canAutoApplyProfileCandidate(aisha, hints), true);
    assert.equal(canAutoApplyProfileCandidate(random, hints), false);
    assert.equal(canAutoApplyProfileCandidate(medium, hints), false);

    const { autoApply, pending } = partitionAutoApplyCandidates(
      [aisha, random, medium],
      hints
    );
    assert.equal(autoApply.length, 1);
    assert.equal(pending.length, 2);

    const stamped = stampCandidateApproved(aisha, {
      approvedBy: "owner-1",
      autoApplied: true,
    });
    assert.equal(stamped.auto_applied, true);
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
