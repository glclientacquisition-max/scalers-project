/**
 * Transcript turn order: seq asc nulls last, then created_at (Voice #745).
 * Run: node --experimental-strip-types --no-warnings --test tests/transcriptOrder.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMissingSeqColumn, sortTranscriptTurns } from "../dashboard/src/lib/transcriptOrder.ts";

describe("sortTranscriptTurns", () => {
  it("puts the greeting first when rows share a timestamp", () => {
    const at = "2026-10-17T06:47:00.000Z";
    const rows = [
      { id: "b", created_at: at, seq: 1, speaker: "caller" },
      { id: "a", created_at: at, seq: 0, speaker: "agent" },
    ];
    assert.deepEqual(sortTranscriptTurns(rows).map((r) => r.speaker), ["agent", "caller"]);
  });

  it("falls back to created_at when seq is null or absent", () => {
    const rows = [
      { id: "2", created_at: "2026-10-17T06:47:02Z" },
      { id: "1", created_at: "2026-10-17T06:47:01Z", seq: null },
      { id: "0", created_at: "2026-10-17T06:47:03Z", seq: 0 },
    ];
    assert.deepEqual(sortTranscriptTurns(rows).map((r) => r.id), ["0", "1", "2"]);
  });

  it("detects a missing seq column", () => {
    assert.equal(isMissingSeqColumn({ code: "42703", message: "column transcripts.seq does not exist" }), true);
    assert.equal(isMissingSeqColumn({ message: "permission denied" }), false);
    assert.equal(isMissingSeqColumn(null), false);
  });
});
