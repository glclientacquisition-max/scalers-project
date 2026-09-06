"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/previewAudio.ts");
const voicePreviewPath = path.join(__dirname, "../dashboard/src/lib/voicePreview.ts");
const ttsPreviewPath = path.join(__dirname, "../src/speech/ttsPreview.js");
const tenantFormPath = path.join(__dirname, "../dashboard/src/components/TenantForm.tsx");
const testLinePath = path.join(__dirname, "../dashboard/src/components/TestLinePanel.tsx");

function wavBytes(size) {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  return Array.from(bytes);
}

function loadHelper() {
  const script = `
    import {
      hasWavMagic,
      isUsableWavBytes,
      isPlayablePreviewMetadata,
      previewErrorCopy,
      NO_VOICE_SAMPLE_COPY,
    } from ${JSON.stringify(helperPath)};
    const valid = Uint8Array.from(${JSON.stringify(wavBytes(44))});
    const shortWav = Uint8Array.from(${JSON.stringify(wavBytes(12))});
    const empty = new Uint8Array(0);
    const html = new TextEncoder().encode("<!doctype html>");
    const json = new TextEncoder().encode('{"error":"nope"}');
    console.log(JSON.stringify({
      copy: NO_VOICE_SAMPLE_COPY,
      valid: isUsableWavBytes(valid),
      validMagic: hasWavMagic(valid),
      short: isUsableWavBytes(shortWav),
      empty: isUsableWavBytes(empty),
      html: isUsableWavBytes(html),
      json: isUsableWavBytes(json),
      durationOk: isPlayablePreviewMetadata(1.2),
      durationZero: isPlayablePreviewMetadata(0),
      durationNaN: isPlayablePreviewMetadata(Number.NaN),
      browserMedia: previewErrorCopy(new Error("Failed to load because no supported source was found.")),
      engine: previewErrorCopy(new Error("Could not reach voice engine at https://example.")),
    }));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

test("only a real WAV payload is a usable voice sample", () => {
  const result = loadHelper();
  assert.equal(result.copy, "No voice sample available.");
  assert.equal(result.valid, true);
  assert.equal(result.validMagic, true);
  assert.equal(result.short, false);
  assert.equal(result.empty, false);
  assert.equal(result.html, false);
  assert.equal(result.json, false);
  assert.equal(result.durationOk, true);
  assert.equal(result.durationZero, false);
  assert.equal(result.durationNaN, false);
  assert.equal(result.browserMedia, "No voice sample available.");
  assert.equal(result.engine, "Could not reach voice engine at https://example.");
});

test("voice preview API rejects a non-WAV body before returning audio/wav", () => {
  const source = fs.readFileSync(voicePreviewPath, "utf8");
  assert.match(source, /isUsableWavBytes/);
  assert.match(source, /NO_VOICE_SAMPLE_COPY/);
});

test("desk preview object URL is typed audio/wav", () => {
  const source = fs.readFileSync(helperPath, "utf8");
  assert.match(source, /type: "audio\/wav"/);
});

test("voice preview packs browser-playable WAV", () => {
  const source = fs.readFileSync(ttsPreviewPath, "utf8");
  assert.match(source, /pcmToBrowserWav/);
});

test("Hear sample mounts audio only after a usable preview blob", () => {
  const source = fs.readFileSync(tenantFormPath, "utf8");
  assert.match(source, /objectUrlFromPreviewResponse/);
  assert.match(source, /assertPreviewAudioPlayable/);
  assert.match(source, /Hear sample/);
  assert.match(source, /onError=/);
  assert.match(source, /voice-sample-empty/);
  assert.match(source, /type="audio\/wav"/);
  assert.doesNotMatch(source, /createObjectURL\(blob\)/);
});

test("phone preview uses the same usable-audio gate", () => {
  const source = fs.readFileSync(testLinePath, "utf8");
  assert.match(source, /objectUrlFromPreviewResponse/);
  assert.match(source, /assertPreviewAudioPlayable/);
  assert.match(source, /onError=/);
  assert.match(source, /type="audio\/wav"/);
  assert.doesNotMatch(source, /createObjectURL\(blob\)/);
});
