/**
 * Prove Use this take works without GEMINI_API_KEY (local pack-target fallback).
 * Run: cd dashboard && npx tsx --tsconfig tsconfig.json ../scripts/verify-pronunciation-fallback.ts
 */
import assert from "node:assert/strict";
import { normalizeAudioMimeForGemini } from "../dashboard/src/lib/gemini.ts";
import { deriveLexiconFromRecording } from "../dashboard/src/lib/pronunciationFromRecording.ts";
import { matchPatternFromPhrase } from "../dashboard/src/lib/pronunciationLexicon.ts";

// Ensure we exercise the no-key path in this process.
delete process.env.GEMINI_API_KEY;

const tinyWebm = Buffer.from("webm-audio-placeholder").toString("base64");

async function main() {
  assert.equal(
    normalizeAudioMimeForGemini("audio/webm;codecs=opus"),
    "audio/webm"
  );

  const result = await deriveLexiconFromRecording({
    prompt: "Hello, you've reached ChapterOne Bookstore, this is Aisha speaking.",
    label: "Greeting",
    kind: "sentence",
    targets: [
      {
        label: "ChapterOne Bookstore",
        match: matchPatternFromPhrase("ChapterOne Bookstore"),
      },
      { label: "Aisha", match: matchPatternFromPhrase("Aisha") },
    ],
    audioBase64: tinyWebm,
    audioMimeType: "audio/webm;codecs=opus",
  });

  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  if (!result.ok) return;
  assert.equal(result.source, "local");
  assert.ok(result.entries.length >= 2, "expected both pack targets");
  const labels = result.entries.map((e) => e.label).join(" | ");
  assert.match(labels, /Aisha/i);
  assert.match(labels, /ChapterOne/i);
  for (const e of result.entries) {
    assert.ok(e.say, `missing say for ${e.label}`);
    assert.doesNotMatch(e.match, /^(where|city|located)$/i);
  }

  console.log("OK  mime normalize + local fallback without GEMINI_API_KEY");
  console.log(
    "    entries:",
    result.entries.map((e) => `${e.label} → ${e.say}`).join("; ")
  );
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
