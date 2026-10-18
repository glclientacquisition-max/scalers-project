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
      recordingDeletedByRetention,
      RECORDING_RETENTION_DELETED_COPY,
      RECORDING_RETENTION_NOTE,
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
    console.log(JSON.stringify({
      copy: NO_RECORDING_COPY,
      results,
      deleted: recordingDeletedByRetention({ recording_deleted_at: "2026-01-01T00:00:00.000Z" }),
      deletedCopy: RECORDING_RETENTION_DELETED_COPY,
      retentionNote: RECORDING_RETENTION_NOTE,
    }));
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
  assert.match(source, /call-recording-deleted/);
  assert.match(source, /recordingRetentionDeletedLabel/);
  assert.match(source, /recordingRetentionNote/);
  assert.match(source, /effectiveRetention/);
  assert.match(source, /NO_RECORDING_COPY/);
  assert.match(source, /if \(!src\)/);
  assert.match(source, /variant === "player"/);
  assert.match(source, /variant === "empty"/);
  assert.doesNotMatch(source, /Sauti Kit|SautiKit/i);
});

test("recordingDeletedByRetention drives the deleted copy on Calls", () => {
  const { deleted, deletedCopy, retentionNote } = loadHelper();
  assert.equal(deleted, true);
  assert.equal(deletedCopy, "Recording deleted after 30 days");
  assert.equal(retentionNote, "Recordings are kept for 30 days.");
  const playback = fs.readFileSync(playbackPath, "utf8");
  assert.match(playback, /recordingDeletedByRetention/);
  const ticket = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/components/InboxTicketView.tsx"),
    "utf8"
  );
  assert.match(ticket, /recordingRetentionDeleted/);
  assert.match(ticket, /retentionDeleted=\{recordingRetentionDeleted\}/);
});

test("CallAudioPlayer does not render audio without a usable source", () => {
  const source = fs.readFileSync(playerPath, "utf8");
  assert.match(source, /usableRecordingUrl/);
  assert.match(source, /if \(!playable\) \{\s*return null;/);
  assert.match(source, /<audio[\s\S]*src=\{playable\}/);
});

test("call detail uses CallRecording and still renders transcript and metadata", () => {
  const source = fs.readFileSync(callDetailPath, "utf8");
  const ticketPath = path.join(__dirname, "../dashboard/src/components/InboxTicketView.tsx");
  const transcriptPath = path.join(__dirname, "../dashboard/src/components/CallTranscript.tsx");
  const ticket = fs.readFileSync(ticketPath, "utf8");
  const transcript = fs.readFileSync(transcriptPath, "utf8");
  assert.match(ticket, /<CallRecording[\s\S]*recordingUrl=\{recordingUrl\}/);
  assert.match(ticket, /retentionDeleted=\{recordingRetentionDeleted\}/);
  assert.equal((ticket.match(/<CallRecording/g) || []).length, 1);
  assert.doesNotMatch(ticket, /variant="empty"/);
  assert.doesNotMatch(ticket, /variant="player"/);
  assert.doesNotMatch(source, /CallAudioPlayer/);
  assert.match(transcript, /stream\.length === 0/);
  assert.match(transcript, /Conversation/);
  assert.match(transcript, /Caller/);
  assert.match(ticket, /Assist/);
  assert.match(source, /Passed to/);
  assert.doesNotMatch(source, /Alert sent/);
  assert.match(source, /row\.primary_intent/);
  assert.match(source, /loadTranscriptTurns\(workspace\.client, id\)/);
});

test("helper and empty-state files exist as required", () => {
  assert.ok(fs.existsSync(helperPath));
  assert.ok(fs.existsSync(recordingUiPath));
  const helper = fs.readFileSync(helperPath, "utf8");
  assert.match(helper, /typeof value !== "string"/);
  assert.match(helper, /trimmed\.length > 0/);
});

// Recordings are private Storage objects; the stored link expires (7 days, or
// 15 minutes for a provider link). The Calls page re-signs on every load and
// only ever signs the path that belongs to this call.
const playbackPath = path.join(__dirname, "../dashboard/src/lib/recordingPlayback.ts");

function runPlayback(body) {
  const script = `
    import { recordingStoragePath, RECORDINGS_BUCKET, RECORDING_PLAYBACK_TTL_SECONDS } from ${JSON.stringify(helperPath)};
    ${body}
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

test("recordingStoragePath only accepts this call's own object", () => {
  const out = runPlayback(`
    console.log(JSON.stringify({
      bucket: RECORDINGS_BUCKET,
      ttl: RECORDING_PLAYBACK_TTL_SECONDS,
      own: recordingStoragePath({ recording_path: "HD_abc/123.wav" }, "HD_abc"),
      other: recordingStoragePath({ recording_path: "HD_xyz/123.wav" }, "HD_abc"),
      prefixTrick: recordingStoragePath({ recording_path: "HD_abcd/1.wav" }, "HD_abc"),
      dots: recordingStoragePath({ recording_path: "HD_abc/../HD_xyz/1.wav" }, "HD_abc"),
      none: recordingStoragePath({}, "HD_abc"),
      noSid: recordingStoragePath({ recording_path: "HD_abc/1.wav" }, null),
    }));
  `);
  assert.deepEqual(out, {
    bucket: "call-recordings",
    ttl: 3600,
    own: "HD_abc/123.wav",
    other: null,
    prefixTrick: null,
    dots: null,
    none: null,
    noSid: null,
  });
});

test("playableCallRecordingUrl re-signs the private object and falls back to the stored link", () => {
  const source = fs.readFileSync(playbackPath, "utf8");
  assert.match(source, /createSignedUrl\(path, RECORDING_PLAYBACK_TTL_SECONDS\)/);
  assert.match(source, /recordingStoragePath\(meta, row\.sautikit_call_sid\)/);
  assert.match(source, /recordingDeletedByRetention\(meta\)/);
  assert.match(source, /return usableRecordingUrl\(row\.recording_url\)/);
  const page = fs.readFileSync(callDetailPath, "utf8");
  // Signed only after the tenant-scoped fetch, and the player gets the fresh link.
  assert.match(page, /\.eq\("tenant_id", tenant\.id\)/);
  assert.match(page, /await playableCallRecordingUrl\(row, meta\)/);
  assert.match(page, /recordingUrl=\{recordingUrl\}/);
  assert.doesNotMatch(page, /recordingUrl=\{row\.recording_url\}/);
});
