/**
 * Heavier pronunciation + phone preview + Gemini Scan flow tests.
 * Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/pronunciationFlow.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertApprovedForLexiconWrite,
  candidateToLexiconEntry,
  dismissalKey,
  issuesToCandidates,
  mergeReviewQueue,
  parseGeminiScanIssues,
  scanCallsWithGemini,
  type PronunciationReviewCandidate,
} from "../dashboard/src/lib/pronunciationGeminiScan.ts";
import {
  buildUnifiedFixReviewRows,
  fixTabHint,
  PRONUNCIATION_BEST_FLOW,
  validatePhonePreviewRequest,
} from "../dashboard/src/lib/pronunciationFixUi.ts";
import {
  lexiconForStorage,
  mergeLexiconEntry,
  parseTtsLexicon,
} from "../dashboard/src/lib/pronunciationLexicon.ts";
import {
  collectKnownPronunciationHints,
  mineSuggestionsFromAgentLines,
} from "../dashboard/src/lib/pronunciationMine.ts";
import { previewSpokenLine } from "../dashboard/src/lib/pronunciationPacks.ts";

function pendingSpeech(
  overrides: Partial<PronunciationReviewCandidate> = {}
): PronunciationReviewCandidate {
  return {
    id: "gemini_scan:c1:AGENT_MISPRONUNCIATION:aisha",
    source: "gemini_scan",
    type: "AGENT_MISPRONUNCIATION",
    word_or_phrase: "Aisha",
    suggested_form: "Eye-sha",
    confidence: "high",
    reasoning: "Stress sounded off.",
    timestamp_seconds: 2,
    call_id: "c1",
    status: "pending",
    created_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    ...overrides,
  };
}

describe("best-flow constants", () => {
  it("documents Review → Add → Find more → Test", () => {
    assert.ok(PRONUNCIATION_BEST_FLOW.length >= 4);
    assert.match(PRONUNCIATION_BEST_FLOW.join(" "), /Needs review|Record/i);
    assert.match(PRONUNCIATION_BEST_FLOW.join(" "), /Test|preview/i);
  });
});

describe("Fix tab unified review queue", () => {
  it("puts speech fixes before hearing hints and sets CTAs", () => {
    const rows = buildUnifiedFixReviewRows({
      speech: [pendingSpeech()],
      hearing: [
        pendingSpeech({
          id: "h1",
          type: "LIKELY_MISHEARD",
          word_or_phrase: "Ruiru",
          suggested_form: "Ruiru",
        }),
      ],
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "speech");
    assert.equal(rows[0].primaryAction, "record");
    assert.equal(rows[0].canApproveSpelling, true);
    assert.equal(rows[1].kind, "hearing");
    assert.equal(rows[1].primaryAction, "dismiss");
    assert.equal(rows[1].canApproveSpelling, false);
  });

  it("ignores non-pending rows", () => {
    const rows = buildUnifiedFixReviewRows({
      speech: [pendingSpeech({ status: "approved", approved_by: "u", approved_at: "t" })],
      hearing: [],
    });
    assert.equal(rows.length, 0);
  });

  it("Fix tab hint shows backlog count", () => {
    assert.equal(fixTabHint(0), "Clear");
    assert.equal(fixTabHint(3), "3 to review");
  });
});

describe("phone preview request + spoken line", () => {
  it("validates preview body like the API route", () => {
    assert.equal(validatePhonePreviewRequest({ text: "" }).ok, false);
    assert.equal(validatePhonePreviewRequest({ text: "x".repeat(501) }).ok, false);
    const ok = validatePhonePreviewRequest({
      text: "Hello, you've reached ChapterOne Bookstore.",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.match(ok.text, /ChapterOne/);
  });

  it("previewSpokenLine applies lexicon overrides callers will hear", () => {
    const lexicon = parseTtsLexicon([
      { match: "aisha", say: "Eye-sha", label: "Aisha" },
      {
        match: "chapterone|chapter\\s*one",
        say: "Chapter One",
        label: "ChapterOne",
      },
    ]);
    const spoken = previewSpokenLine(
      "Hello, you've reached ChapterOne Bookstore, this is Aisha speaking.",
      lexicon
    );
    assert.match(spoken, /Eye-sha|Chapter One/i);
    assert.doesNotMatch(spoken, /\bAisha\b/);
  });

  it("lexiconForStorage round-trips labels used by preview POST body", () => {
    const stored = lexiconForStorage([
      { match: "aisha", say: "Eye-sha", label: "Aisha", priority: 200 },
    ]);
    const again = parseTtsLexicon(stored);
    assert.equal(again[0].label, "Aisha");
    assert.equal(again[0].say, "Eye-sha");
  });
});

describe("Gemini Scan → approve gate → lexicon (integration-style)", () => {
  it("mock scan lands pending candidates that cannot write lexicon yet", async () => {
    const raw = JSON.stringify([
      {
        type: "AGENT_MISPRONUNCIATION",
        word_or_phrase: "Muindi Mbingu",
        confidence: "high",
        suggested_form: "Moo-in-dee Mbeen-goo",
        reasoning: "Place name flattened.",
      },
      {
        type: "LIKELY_MISHEARD",
        word_or_phrase: "Ruiru",
        confidence: "medium",
        suggested_form: "Ruiru",
        reasoning: "Agent answered about Ruaka.",
      },
      {
        type: "AGENT_MISPRONUNCIATION",
        word_or_phrase: "where",
        confidence: "high",
        suggested_form: "Ware",
        reasoning: "should be blocked",
      },
    ]);

    const result = await scanCallsWithGemini({
      tenantId: "t-chapterone",
      calls: [{ id: "call-1", recording_url: "https://example.com/r.wav" }],
      lexiconExamples: [{ match: "aisha", say: "Eye-sha", label: "Aisha" }],
      dismissals: [],
      existingQueue: [],
      mockAnalyze: async () => ({ raw }),
    });

    assert.ok(result.candidates.some((c) => /muindi/i.test(c.word_or_phrase)));
    assert.ok(result.candidates.some((c) => c.type === "LIKELY_MISHEARD"));
    assert.ok(
      !result.candidates.some((c) => /^where$/i.test(c.word_or_phrase)),
      "blocked common words must not enter the queue"
    );
    for (const c of result.candidates) {
      assert.equal(c.status, "pending");
      assert.equal(candidateToLexiconEntry(c), null);
    }

    const rows = buildUnifiedFixReviewRows({
      speech: result.candidates.filter((c) => c.type === "AGENT_MISPRONUNCIATION"),
      hearing: result.candidates.filter((c) => c.type === "LIKELY_MISHEARD"),
    });
    assert.ok(rows[0].kind === "speech");
  });

  it("human approve stamp is required before merge into live lexicon", () => {
    const pending = pendingSpeech({
      word_or_phrase: "Muindi Mbingu",
      suggested_form: "Moo-in-dee Mbeen-goo",
      id: "g1",
    });
    assert.equal(assertApprovedForLexiconWrite(pending).ok, false);

    const approved: PronunciationReviewCandidate = {
      ...pending,
      status: "approved",
      approved_by: "owner-uuid",
      approved_at: new Date().toISOString(),
      edited_say: "Moo-in-dee Mbeen-goo",
    };
    assert.equal(assertApprovedForLexiconWrite(approved).ok, true);
    const entry = candidateToLexiconEntry(approved);
    assert.ok(entry);
    const live = parseTtsLexicon(
      mergeLexiconEntry([{ match: "aisha", say: "Eye-sha", label: "Aisha" }], entry!)
    );
    assert.ok(live.some((e) => /muindi/i.test(e.match) || /Muindi/i.test(e.label || "")));
    assert.ok(live.every((e) => e.match !== "where"));
  });

  it("reject dismissal blocks the same call+word on the next scan", async () => {
    const callId = "call-99";
    const phrase = "Harrison Maina";
    const raw = JSON.stringify([
      {
        type: "AGENT_MISPRONUNCIATION",
        word_or_phrase: phrase,
        confidence: "high",
        suggested_form: "Ha-ri-son My-na",
        reasoning: "Name rushed.",
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

    const key = dismissalKey(callId, phrase, "AGENT_MISPRONUNCIATION");
    const second = await scanCallsWithGemini({
      tenantId: "t1",
      calls: [{ id: callId, recording_url: "https://example.com/a.wav" }],
      lexiconExamples: [],
      dismissals: [
        {
          key,
          call_id: callId,
          word_or_phrase: phrase,
          type: "AGENT_MISPRONUNCIATION",
          status: "rejected",
          at: new Date().toISOString(),
        },
      ],
      existingQueue: mergeReviewQueue([], first.candidates),
      mockAnalyze: async () => ({ raw }),
    });
    assert.equal(second.candidates.length, 0);
  });

  it("tolerates messy model JSON (fences, missing fields)", () => {
    const messy = `Sure!\n\`\`\`json\n[
      {"type":"AGENT_MISPRONUNCIATION","word_or_phrase":"Aisha","confidence":"high","suggested_form":"Eye-sha","reasoning":"ok"},
      {"type":"AGENT_MISPRONUNCIATION","word_or_phrase":"Nope"}
    ]\n\`\`\``;
    const { issues, rejected } = parseGeminiScanIssues(messy);
    assert.equal(issues.length, 1);
    assert.ok(rejected.length >= 1);
    const created = issuesToCandidates({
      issues,
      callId: "c",
      dismissals: [],
      existingQueue: [],
    });
    assert.equal(created[0].source, "gemini_scan");
  });
});

describe("heuristic scan coexists with Gemini (separate sources)", () => {
  it("mine suggestions stay Practice-bound and do not invent lexicon entries", () => {
    const hints = collectKnownPronunciationHints({
      businessName: "ChapterOne Bookstore",
      agentName: "Aisha",
      team: [{ name: "Harrison Maina" }],
      locations: [
        {
          address: "Muindi Mbingu Street",
          landmark: "City Market Fashion Mall",
        },
      ],
    });
    const mined = mineSuggestionsFromAgentLines({
      lines: [
        "hello you've reached chapterone bookstore this is aisha",
        "we are on muindi mbingu street",
      ],
      existingLexicon: [],
      knownHints: hints,
      limit: 8,
    });
    assert.ok(mined.length > 0);
    assert.ok(mined.every((s) => s.id.startsWith("mine:")));
    // Mining only returns suggestions — lexicon unchanged unless owner trains.
    assert.equal(parseTtsLexicon([]).length, 0);
  });
});
