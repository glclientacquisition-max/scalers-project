import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { foldInboxRedials, isNoAudioRedial, redialCallerKey } from "../dashboard/src/lib/inboxRedialFold.ts";

const ESGA = "+254712000111"; // fixture number, not a real caller
function call(id: string, sid: string, at: string, dur: number, extra: Record<string, unknown> = {}): any {
  return {
    id, createdAt: at, callId: id, callerPhone: ESGA, callerName: "Esga", hold: null, job: null,
    needsYou: false, headline: "Call", lead: { call: { id, sautikit_call_sid: sid, created_at: at, duration_seconds: dur, recording_url: null, summary: null, ...extra } },
  };
}

// Esga, 19 Oct 19:25 EAT (16:25Z): a real call and the two 0 s no-audio redials.
const real = call("c-real", "HD_real", "2026-10-19T16:23:40Z", 74, { recording_url: "rec", summary: "{\"topic\":\"delivery\"}" });
const r1 = call("c-95de", "HD_95de7de22090", "2026-10-19T16:25:02Z", 0);
const r2 = call("c-bcbb", "HD_bcbb833fb311", "2026-10-19T16:25:31Z", 0);

test("Esga pair HD_95de7de22090 and HD_bcbb833fb311 show as 0 s child lines under the real call", () => {
  const out = foldInboxRedials([r2, r1, real]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "c-real");
  assert.deepEqual(out[0].redials!.map((r) => r.sid), ["HD_95de7de22090", "HD_bcbb833fb311"]);
  assert.ok(out[0].redials!.every((r) => r.durationSeconds === 0));
});

test("display only: inputs untouched, ids and call ids kept, no minutes or recordings folded", () => {
  const before = JSON.stringify([r2, r1, real]);
  const out = foldInboxRedials([r2, r1, real]);
  assert.equal(JSON.stringify([r2, r1, real]), before);
  assert.equal(out[0].lead!.call.duration_seconds, 74);
  assert.equal(out[0].lead!.call.recording_url, "rec");
  assert.deepEqual(out[0].redials!.map((r) => r.callId), ["c-95de", "c-bcbb"]);
});

test("the pair with no real call nearby stays as its own rows", () => {
  const out = foldInboxRedials([r2, r1]);
  assert.equal(out.length, 2);
  assert.ok(out.every((i) => !i.redials));
});

test("outside the window, other callers, withheld numbers, and calls with audio never fold", () => {
  const far = call("c-far", "HD_far", "2026-10-19T17:00:00Z", 0);
  assert.equal(foldInboxRedials([far, real]).length, 2);
  const other = { ...call("c-oth", "HD_oth", "2026-10-19T16:25:10Z", 0), callerPhone: "+254733000222" };
  assert.equal(foldInboxRedials([other, real]).length, 2);
  const anon = { ...call("c-anon", "HD_a", "2026-10-19T16:25:10Z", 0), callerPhone: "unknown" };
  const anonReal = { ...real, callerPhone: "unknown" };
  assert.equal(foldInboxRedials([anon, anonReal]).length, 2);
  assert.equal(redialCallerKey("unknown"), null);
  assert.equal(isNoAudioRedial(call("c-rec", "HD_r", real.createdAt, 0, { recording_url: "x" })), false);
  assert.equal(isNoAudioRedial({ ...r1, hold: { id: "h" } }), false);
});

test("loader folds for display only; the row renders a visible '0 s · hang-up' line", () => {
  const load = readFileSync("dashboard/src/lib/inboxLoad.ts", "utf8");
  assert.match(load, /items: foldInboxRedials\(withPeople\)/);
  const lib = readFileSync("dashboard/src/lib/inboxRedialFold.ts", "utf8");
  assert.doesNotMatch(lib, /\.(insert|update|delete|upsert|rpc)\(/);
  const row = readFileSync("dashboard/src/components/InboxItemRow.tsx", "utf8");
  assert.match(row, /0 s · hang-up/);
  assert.equal((row.match(/<InboxRedialLines item=\{item\} \/>/g) || []).length, 4);
});
