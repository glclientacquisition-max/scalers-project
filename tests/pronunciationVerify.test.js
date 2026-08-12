/**
 * Mime normalization + verify error-path helpers for Pronunciation Keep.
 * Run: node --test tests/pronunciationVerify.test.js
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function normalizeAudioMimeForGemini(mime) {
  const raw = String(mime || "")
    .toLowerCase()
    .split(";")[0]
    .trim();
  if (!raw || raw === "application/octet-stream") return "audio/webm";
  if (raw === "audio/webm" || raw === "audio/mp4" || raw === "audio/mpeg") {
    return raw;
  }
  if (
    raw === "audio/mp3" ||
    raw === "audio/m4a" ||
    raw === "audio/wav" ||
    raw === "audio/ogg"
  ) {
    return raw;
  }
  if (raw.startsWith("audio/")) return raw;
  return "audio/webm";
}

describe("normalizeAudioMimeForGemini", () => {
  it("strips MediaRecorder codec params that Gemini rejects", () => {
    assert.equal(
      normalizeAudioMimeForGemini("audio/webm;codecs=opus"),
      "audio/webm"
    );
    assert.equal(
      normalizeAudioMimeForGemini("audio/mp4;codecs=mp4a.40.2"),
      "audio/mp4"
    );
  });

  it("defaults empty / octet-stream to webm", () => {
    assert.equal(normalizeAudioMimeForGemini(""), "audio/webm");
    assert.equal(
      normalizeAudioMimeForGemini("application/octet-stream"),
      "audio/webm"
    );
  });
});
