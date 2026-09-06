"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const helperPath = path.join(__dirname, "../dashboard/src/lib/recordingSource.ts");
const recordingUiPath = path.join(__dirname, "../dashboard/src/components/CallRecording.tsx");
const playerPath = path.join(__dirname, "../dashboard/src/components/CallAudioPlayer.tsx");
const callDetailPath = path.join(__dirname, "../dashboard/src/app/(desk)/calls/[id]/page.tsx");

function loadHelper() {
  const script = `
    import {
      usableRecordingUrl,
      hasUsableRecordingSource,
      recordingPlaybackKind,
      NO_RECORDING_COPY,
    } from ${JSON.stringify(helperPath)};
    const cases = [
      ["https://cdn.example/rec.mp3", "https://cdn.example/rec.mp3", true, "player"],
      ["  https://cdn.example/rec.mp3  ", "https://cdn.example/rec.mp3", true, "player"],
      [null, null, false, "empty"],
      [undefined, null, false, "empty"],
      ["", null, false, "empty"],
      ["   ", null, false, "empty"],
      [123, null, false, "empty"],
    ];
    const results = cases.map(([value]) => ({
      url: usableRecordingUrl(value),
      has: hasUsableRecordingSource(value),
      kind: recordingPlaybackKind(value),
    }));
    console.log(JSON.stringify({ copy: NO_RECORDING_COPY, results }));
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

test("usable recording URL is required before playback", () => {
  const { copy, results } = loadHelper();
  assert.equal(copy, "No recording available for this call.");
  const expected = [
    { url: "https://cdn.example/rec.mp3", has: true, kind: "player" },
    { url: "https://cdn.example/rec.mp3", has: true, kind: "player" },
    { url: null, has: false, kind: "empty" },
    { url: null, has: false, kind: "empty" },
    { url: null, has: false, kind: "empty" },
    { url: null, has: false, kind: "empty" },
    { url: null, has: false, kind: "empty" },
  ];
  assert.deepEqual(results, expected);
});

test("CallRecording mounts the player only for a usable source", () => {
  const source = fs.readFileSync(recordingUiPath, "utf8");
  assert.match(source, /usableRecordingUrl/);
  assert.match(source, /CallAudioPlayer/);
  assert.match(source, /call-recording-empty/);
  assert.match(source, /NO_RECORDING_COPY/);
  assert.match(source, /if \(!src\)/);
  assert.match(source, /variant === "player"/);
  assert.match(source, /variant === "empty"/);
  assert.doesNotMatch(source, /Sauti Kit|SautiKit/i);
});

test("CallAudioPlayer does not render audio without a usable source", () => {
  const source = fs.readFileSync(playerPath, "utf8");
  assert.match(source, /usableRecordingUrl/);
  assert.match(source, /if \(!playable\) \{\s*return null;/);
  assert.match(source, /<audio[\s\S]*src=\{playable\}/);
});

test("call detail uses CallRecording and still renders transcript and metadata", () => {
  const source = fs.readFileSync(callDetailPath, "utf8");
  assert.match(source, /<CallRecording recordingUrl=\{row\.recording_url\} variant="empty" \/>/);
  assert.match(source, /<CallRecording recordingUrl=\{row\.recording_url\} variant="player" \/>/);
  assert.doesNotMatch(source, /CallAudioPlayer/);
  assert.match(source, /turns\.length === 0/);
  assert.match(source, /Conversation/);
  assert.match(source, /Caller/);
  assert.match(source, /Assist/);
  assert.match(source, /Escalation/);
  assert.match(source, /Alert sent/);
  assert.match(source, /row\.primary_intent/);
  assert.match(source, /from\("transcripts"\)/);
});

test("helper and empty-state files exist as required", () => {
  assert.ok(fs.existsSync(helperPath));
  assert.ok(fs.existsSync(recordingUiPath));
  const helper = fs.readFileSync(helperPath, "utf8");
  assert.match(helper, /typeof value !== "string"/);
  assert.match(helper, /trimmed\.length > 0/);
});
