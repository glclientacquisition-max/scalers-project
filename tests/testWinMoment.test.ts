/** Run: node --experimental-strip-types --test tests/testWinMoment.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchTestCall, matchTestCallId, showWinMoment } from "../dashboard/src/lib/callSetupStatus.ts";

const setup = { test_from: "+254712345678", test_started_at: "2026-10-30T09:00:00.000Z" };

test("matchTestCallId picks the same call as matchTestCall", () => {
  const calls = [
    { id: "a", caller_number: "+254700000001", created_at: "2026-10-30T09:01:00.000Z" },
    { id: "b", caller_number: "0712345678", created_at: "2026-10-30T09:03:00.000Z" },
    { id: "c", caller_number: "254712345678", created_at: "2026-10-30T09:05:00.000Z" },
  ];
  assert.equal(matchTestCall(setup, calls), "2026-10-30T09:03:00.000Z");
  assert.equal(matchTestCallId(setup, calls), "b");
  assert.equal(matchTestCallId(setup, [calls[0]]), null);
  assert.equal(matchTestCallId(null, calls), null);
});

test("win moment shows once, only for a call we saw", () => {
  const base = { tested_at: "2026-10-30T09:03:00.000Z", tested_via: "auto" as const, auto_seen_at: null };
  assert.equal(showWinMoment(base), true);
  assert.equal(showWinMoment({ ...base, auto_seen_at: "2026-10-30T09:04:00.000Z" }), false);
  assert.equal(showWinMoment({ ...base, tested_via: "manual" as const }), false);
  assert.equal(showWinMoment({ ...base, tested_at: null }), false);
});

test("win card copy and wiring", () => {
  const ui = readFileSync(new URL("../dashboard/src/app/onboarding/line/TestWinMoment.tsx", import.meta.url), "utf8");
  assert.match(ui, /Your Business Assistant answered/);
  assert.match(ui, /`\/calls\/\$\{callId\}`/);
  assert.match(ui, /router\.push\("\/home"\)/);
  const card = readFileSync(new URL("../dashboard/src/app/onboarding/line/CallSetupTest.tsx", import.meta.url), "utf8");
  assert.match(card, /showWinMoment\(setup\)/);
  assert.match(card, /auto_seen_at: new Date\(\)\.toISOString\(\)/);
});
