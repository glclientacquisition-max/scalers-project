const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  releaseKeyFromCall,
  topFailureFromChecks,
  rollupBusiness,
  rollupBusinesses,
  rollupReleases,
  CHECK_LABELS,
} = require("../dashboard/src/lib/quality/rollup");
const {
  callsFromRows,
  listBusinessQuality,
  getBusinessQuality,
  getCallTrace,
  listReleaseDeltasFromRows,
  interpretTraceQuery,
  isMissingScoreColumn,
  RELEASE_GAP,
  parseWindowDays,
  parseCallLimit,
} = require("../dashboard/src/lib/quality/assemble");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function turn(caller, spoken, extra = {}) {
  return {
    turnIndex: extra.turnIndex || 1,
    caller: { text: caller, language: extra.callerLang || null },
    stages: [
      { stage: "turn_end", decision: extra.hold ? "hold" : "flush" },
      {
        stage: "model",
        phase: "output",
        outputText: extra.model == null ? spoken : extra.model,
      },
      ...(extra.stages || []),
      { stage: "tts", text: spoken, language: extra.ttsLang || "sw" },
      { stage: "outcome", value: extra.outcome || "replay" },
      { stage: "latency", callerStopToFirstTtsPcmMs: extra.pcm ?? null },
    ],
  };
}

describe("quality rollup", () => {
  it("prefers release.gitSha and otherwise buckets by Nairobi day", () => {
    assert.deepEqual(
      releaseKeyFromCall(
        { release: { gitSha: "abc1234", branch: "main", label: "staging" } },
        "2026-10-06T21:30:00.000Z",
      ),
      { key: "abc1234", source: "release", gitSha: "abc1234", branch: "main", label: "staging" },
    );
    assert.deepEqual(releaseKeyFromCall({ gitSha: "legacy" }, "2026-10-06T21:30:00.000Z"), {
      key: "legacy",
      source: "payload",
      gitSha: "legacy",
      branch: null,
      label: null,
    });
    assert.deepEqual(
      releaseKeyFromCall({ stages: [{ stage: "release", value: "rel-9" }] }, "2026-10-06T21:30:00.000Z"),
      { key: "rel-9", source: "payload", gitSha: "rel-9", branch: null, label: null },
    );
    assert.deepEqual(releaseKeyFromCall({}, "2026-10-06T21:30:00.000Z"), {
      key: "2026-10-07",
      source: "day",
      gitSha: null,
      branch: null,
      label: null,
    });
    assert.deepEqual(releaseKeyFromCall({}, "2026-10-06T20:30:00.000Z"), {
      key: "2026-10-06",
      source: "day",
      gitSha: null,
      branch: null,
      label: null,
    });
    assert.match(RELEASE_GAP, /git SHA/);
    assert.match(RELEASE_GAP, /left out/);
  });

  it("breaks top-failure ties toward the heavier check", () => {
    assert.deepEqual(
      topFailureFromChecks({ silence: 1, slow: 1, languageMismatch: 0 }),
      { check: "silence", count: 1 },
    );
    assert.equal(topFailureFromChecks({ silence: 0, slow: 0 }), null);
  });

  it("compares the recent window with the prior window and release buckets", () => {
    const calls = [
      {
        callId: "recent-a",
        tenantId: "biz-1",
        at: NOW - DAY,
        score: 80,
        checks: { languageMismatch: 2, silence: 0 },
        release: { key: "2026-10-06", source: "day" },
      },
      {
        callId: "recent-b",
        tenantId: "biz-1",
        at: NOW - 2 * DAY,
        score: 60,
        checks: { languageMismatch: 0, silence: 1 },
        release: { key: "2026-10-05", source: "day" },
      },
      {
        callId: "prior-c",
        tenantId: "biz-1",
        at: NOW - 10 * DAY,
        score: 90,
        checks: { incomplete: 3 },
        release: { key: "sha-old", source: "payload" },
      },
      {
        callId: "other",
        tenantId: "biz-2",
        at: NOW - DAY,
        score: 50,
        checks: { slow: 4 },
        release: { key: "2026-10-06", source: "day" },
      },
    ];

    const one = rollupBusiness(calls.filter((call) => call.tenantId === "biz-1"), NOW, 7 * DAY);
    assert.equal(one.currentScore, 70);
    assert.equal(one.priorScore, 90);
    assert.equal(one.trend, -20);
    assert.equal(one.trendDirection, "down");
    assert.deepEqual(one.topFailure, { check: "languageMismatch", count: 2 });
    assert.equal(one.callCount, 2);
    assert.equal(one.priorCallCount, 1);
    // Day buckets carry no git SHA, so they never show up as releases.
    assert.deepEqual(
      one.releases.map((row) => ({ key: row.key, score: row.score, delta: row.delta, callCount: row.callCount })),
      [],
    );
    assert.deepEqual(one.scores, [60, 80]);
    assert.equal(one.lastCallAt, new Date(NOW - DAY).toISOString());
    assert.equal(one.checkedCount, 2);

    const home = rollupBusinesses(calls, NOW, 7 * DAY);
    assert.deepEqual(
      home.map((row) => row.businessId),
      ["biz-1", "biz-2"],
    );
    assert.equal(home[1].currentScore, 50);
    assert.equal(home[1].trend, null);
    assert.equal(home[1].trendDirection, "unknown");
    assert.equal(one.dropping, false);
    assert.equal(one.droppingReason, null);
  });

  it("flags a 10 point drop only when both weeks have 5 traced calls", () => {
    const recent = Array.from({ length: 5 }, (_, index) => ({
      callId: `r${index}`,
      tenantId: "biz-1",
      at: NOW - DAY - index * 1000,
      score: 60,
      checks: {},
      release: { key: "sha-new", source: "release", gitSha: "sha-new", branch: "main", label: null },
    }));
    const prior = Array.from({ length: 5 }, (_, index) => ({
      callId: `p${index}`,
      tenantId: "biz-1",
      at: NOW - 10 * DAY - index * 1000,
      score: 80,
      checks: {},
      release: { key: "sha-old", source: "release", gitSha: "sha-old", branch: "main", label: null },
    }));
    const dropped = rollupBusiness([...recent, ...prior], NOW, 7 * DAY);
    assert.equal(dropped.dropping, true);
    assert.equal(dropped.droppingReason, "Score fell 20 points versus the prior 7 days.");

    const short = rollupBusiness(
      [...recent.slice(0, 4), ...prior],
      NOW,
      7 * DAY,
    );
    assert.equal(short.dropping, false);
    assert.equal(short.droppingReason, null);
  });

  it("flags a check that is new this week on 3 calls", () => {
    const recent = Array.from({ length: 3 }, (_, index) => ({
      callId: `n${index}`,
      tenantId: "biz-1",
      at: NOW - DAY - index * 1000,
      score: 80,
      checks: { silence: 1 },
      release: { key: "day", source: "day" },
    }));
    const prior = Array.from({ length: 5 }, (_, index) => ({
      callId: `o${index}`,
      tenantId: "biz-1",
      at: NOW - 10 * DAY - index * 1000,
      score: 80,
      checks: { slow: 1 },
      release: { key: "day", source: "day" },
    }));
    const body = rollupBusiness([...recent, ...prior], NOW, 7 * DAY);
    assert.equal(body.dropping, true);
    assert.equal(
      body.droppingReason,
      "Silence on 3 calls, none in the prior 7 days.",
    );
  });

  it("compares releases by git SHA and skips calls with none", () => {
    const sha = (key, at, score, checks = {}) => ({
      callId: `${key}-${at}`,
      tenantId: "biz-1",
      at: NOW - at * DAY,
      score,
      checks,
      release: { key, source: "release", gitSha: key, branch: "main", label: null },
    });
    const day = (at, score) => ({
      callId: `day-${at}`,
      tenantId: "biz-1",
      at: NOW - at * DAY,
      score,
      checks: null,
      release: { key: "2026-10-03", source: "day", gitSha: null, branch: null, label: null },
    });
    const releases = rollupReleases([sha("aaa", 6, 40, { silence: 2 }), day(5, 99), sha("bbb", 4, 60, { silence: 1 })]);
    assert.deepEqual(
      releases.map((row) => [row.key, row.score, row.delta, row.checks.silence]),
      [
        ["aaa", 40, null, 2],
        ["bbb", 60, 20, 1],
      ],
    );
    assert.equal(releases[1].firstCallAt, new Date(NOW - 4 * DAY).toISOString());
  });

  it("uses plain check words in a Dropping reason", () => {
    for (const check of Object.keys(CHECK_LABELS)) {
      const recent = Array.from({ length: 3 }, (_, index) => ({
        callId: `${check}${index}`,
        tenantId: "biz-1",
        at: NOW - DAY - index * 1000,
        score: 80,
        checks: { [check]: 1 },
      }));
      const reason = rollupBusiness(recent, NOW, 7 * DAY).droppingReason;
      assert.equal(reason, `${CHECK_LABELS[check]} on 3 calls, none in the prior 7 days.`);
      assert.doesNotMatch(reason, new RegExp(`\\b${check}\\b`));
    }
  });

  it("leaves an empty recent window unscored", () => {
    const body = rollupBusiness(
      [
        {
          callId: "old",
          tenantId: "biz-1",
          at: NOW - 10 * DAY,
          score: 40,
          checks: { silence: 1 },
          release: { key: "old", source: "payload" },
        },
      ],
      NOW,
      7 * DAY,
    );
    assert.equal(body.currentScore, null);
    assert.equal(body.priorScore, 40);
    assert.equal(body.trend, null);
    assert.equal(body.topFailure, null);
  });
});

describe("quality trace assembly", () => {
  const tenant = "df4ad9d8-28ff-4810-b1e6-94f5495472b0";

  function row(partial) {
    return {
      call_id: partial.callId,
      tenant_id: tenant,
      turn_index: partial.turnIndex ?? null,
      record_kind: partial.kind,
      pii: "transcript",
      created_at: partial.createdAt,
      payload: partial.payload,
    };
  }

  it("reads call rows and leaves empty turn scores alone", () => {
    const spoken = "Sawa Alvin, nimeelewa. Kuna huduma yoyote ya usafi ungependa tukusaidie nayo leo?";
    const caller = "What services do you offer?";
    const rows = [
      {
        ...row({
          kind: "call",
          createdAt: "2026-10-07T09:00:00.000Z",
          callId: "HD_shape",
          payload: {
            schema: "scalers.voice.call",
            callId: "HD_shape",
            tenantId: tenant,
            startedAt: "2026-10-07T08:59:00.000Z",
            endedAt: "2026-10-07T09:00:00.000Z",
            turnCount: 1,
            voiceId: "voice-1",
            sttModel: "stt-rt-v5",
            ttsModel: "tts-rt-v2",
            pii: "transcript",
            stages: [{ stage: "canned", path: "greeting", text: "Habari Alvin" }],
            score: 100,
            checks: { slow: 9 },
            diagnosis: "payload diagnosis",
          },
        }),
        score: 41,
        checks: { silence: 2 },
        diagnosis: "Silence after a caller turn (turns 1)",
        release: { gitSha: "deadbeef", branch: "main", label: "staging" },
      },
      {
        ...row({
          kind: "turn",
          turnIndex: 1,
          createdAt: "2026-10-07T08:59:30.000Z",
          callId: "HD_shape",
          payload: turn(caller, spoken, { callerLang: "en", ttsLang: "sw", pcm: 900 }),
        }),
        score: null,
        checks: null,
      },
      row({
        kind: "call",
        createdAt: "2026-10-07T08:00:00.000Z",
        callId: "HD_empty",
        payload: {
          startedAt: "2026-10-07T07:59:00.000Z",
          turnCount: 0,
        },
      }),
    ];

    const calls = callsFromRows(rows);
    assert.equal(calls.length, 2);
    const stored = calls.find((call) => call.callId === "HD_shape");
    assert.equal(stored.score, 41);
    assert.equal(stored.scoreSource, "stored");
    assert.equal(stored.checks.silence, 2);
    assert.equal(stored.diagnosis, "Silence after a caller turn (turns 1)");
    assert.equal(stored.release.key, "deadbeef");
    assert.equal(stored.release.source, "release");
    assert.equal(stored.release.branch, "main");
    assert.equal(calls.find((call) => call.callId === "HD_empty").score, null);

    const timeline = getCallTrace({ rows });
    assert.equal(timeline.call.score, 41);
    assert.equal(timeline.call.scoreSource, "stored");
    assert.equal(timeline.call.checks.silence, 2);
    assert.equal(timeline.call.stages[0].text, "Habari Alvin");
    assert.equal(timeline.turns.length, 1);
    assert.equal(timeline.turns[0].caller.text, caller);
    assert.equal(timeline.turns[0].spoken, spoken);
    assert.equal(timeline.turns[0].outcome, "replay");
    assert.equal(timeline.turns[0].score, null);
    assert.equal(timeline.turns[0].checks, null);
    assert.equal(timeline.turns[0].latency.callerStopToFirstTtsPcmMs, 900);
    assert.equal(timeline.turns[0].stages.some((stage) => stage.stage === "tts"), true);
    assert.equal("omit" in timeline.turns[0], false);
    assert.equal("notes" in timeline.turns[0], false);

    const home = listBusinessQuality({
      rows,
      names: { [tenant]: "Done and Dusted" },
      now: NOW,
      windowDays: 7,
      truncated: false,
    });
    assert.equal(home.ready, true);
    assert.equal(home.businesses.length, 1);
    assert.equal(home.businesses[0].businessName, "Done and Dusted");
    assert.equal(home.businesses[0].currentScore, 41);
    assert.equal(home.businesses[0].callCount, 1);
    assert.match(home.release.gap, /git SHA/);

    const list = getBusinessQuality({
      rows,
      businessId: tenant,
      businessName: "Done and Dusted",
      limit: 30,
      now: NOW,
    });
    assert.equal(list.calls.length, 2);
    assert.equal(list.calls[0].callId, "HD_shape");
    assert.equal(list.calls[0].score, 41);
    assert.equal(list.calls[0].scoreSource, "stored");
    assert.equal(list.calls[1].callId, "HD_empty");
    assert.equal(list.calls[1].score, null);
    assert.equal(list.calls[1].scoreSource, null);
    assert.equal(list.dropping, false);
    assert.equal(list.callCount, 1);

    const deltas = listReleaseDeltasFromRows({ rows, businessId: tenant });
    assert.deepEqual(
      deltas.map((bucket) => bucket.key),
      ["deadbeef"],
    );
    assert.equal(deltas[0].score, 41);
    assert.equal(deltas[0].callCount, 1);
  });

  it("passes through a per-turn score when Voice has stored one", () => {
    const rows = [
      {
        ...row({
          kind: "turn",
          turnIndex: 1,
          createdAt: "2026-10-07T08:59:30.000Z",
          callId: "HD_turn_score",
          payload: turn("Ni huduma gani?", "Tuna usafi wa nyumba.", { callerLang: "sw", pcm: 400 }),
        }),
        score: 70,
        checks: { slow: 1 },
      },
    ];
    const timeline = getCallTrace({ rows });
    assert.equal(timeline.call.score, null);
    assert.equal(timeline.call.scoreSource, null);
    assert.equal(timeline.turns[0].score, 70);
    assert.equal(timeline.turns[0].checks.slow, 1);
    assert.equal(timeline.turns[0].spoken, "Tuna usafi wa nyumba.");
    assert.equal(callsFromRows(rows).length, 0);
  });

  it("treats a missing trace table as an empty ready flag", () => {
    const missing = interpretTraceQuery({
      data: null,
      error: { code: "42P01", message: 'relation "public.voice_turn_traces" does not exist' },
    });
    assert.deepEqual(missing, { ready: false, rows: [] });

    const cache = interpretTraceQuery({
      data: null,
      error: { code: "PGRST205", message: "Could not find the table in the schema cache" },
    });
    assert.equal(cache.ready, false);

    assert.throws(
      () => interpretTraceQuery({ data: null, error: { message: "timeout" } }),
      /timeout/,
    );

    const empty = interpretTraceQuery({ data: [], error: null });
    assert.deepEqual(empty, { ready: true, rows: [] });
    assert.equal(
      isMissingScoreColumn({ message: "column voice_turn_traces.score does not exist" }),
      true,
    );
    assert.equal(isMissingScoreColumn({ message: "timeout" }), false);
  });

  it("parses window and limit query values", () => {
    assert.equal(parseWindowDays(null), 7);
    assert.equal(parseWindowDays("14"), 14);
    assert.equal(parseWindowDays("0"), null);
    assert.equal(parseWindowDays("31"), null);
    assert.equal(parseWindowDays("nope"), null);
    assert.equal(parseCallLimit(null), 30);
    assert.equal(parseCallLimit("10"), 10);
    assert.equal(parseCallLimit("500"), null);
  });
});

describe("quality admin routes", () => {
  const root = path.join(__dirname, "..");

  function read(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
  }

  it("gates Quality reads like other Super Admin APIs and does not ship the screen", () => {
    const home = read("dashboard/src/app/api/admin/quality/route.ts");
    const business = read("dashboard/src/app/api/admin/quality/businesses/[businessId]/route.ts");
    const call = read("dashboard/src/app/api/admin/quality/calls/[callId]/route.ts");
    const releases = read("dashboard/src/app/api/admin/quality/releases/route.ts");
    const reader = read("dashboard/src/lib/quality/readQuality.ts");
    const assemble = read("dashboard/src/lib/quality/assemble.js");
    for (const source of [home, business, call, releases]) {
      assert.match(source, /isLegacyAuthenticated/);
      assert.match(source, /ops_only/);
      assert.doesNotMatch(source, /NEXT_PUBLIC_/);
      assert.doesNotMatch(source, /SERVICE_ROLE/);
    }
    assert.match(home, /listBusinessQuality/);
    assert.match(business, /getBusinessQuality/);
    assert.match(call, /getCallTrace/);
    assert.match(releases, /listReleaseDeltas/);
    assert.match(reader, /export async function listBusinessQuality/);
    assert.match(reader, /export async function getBusinessQuality/);
    assert.match(reader, /export async function getCallTrace/);
    assert.match(reader, /export async function listReleaseDeltas/);
    assert.match(reader, /getSupabaseAdmin/);
    assert.match(reader, /voice_turn_traces/);
    assert.equal(reader.match(/\.eq\("record_kind", "call"\)/g).length, 3);
    assert.doesNotMatch(reader, /scoreTurns|diagnoseCall|loadVoiceScore|voiceScoreSnapshot/);
    assert.doesNotMatch(assemble, /scoreTurns|diagnoseCall|loadVoiceScore|voiceScoreSnapshot/);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/app/admin/quality/page.tsx")), false);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/lib/quality/voiceScoreSnapshot.js")), false);
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/lib/quality/loadVoiceScore.js")), false);
    assert.equal(fs.existsSync(path.join(root, "src/speech/voiceScore.js")), true);
  });
});
