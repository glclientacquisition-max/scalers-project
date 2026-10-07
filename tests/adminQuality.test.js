const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const {
  releaseKeyFromCall,
  topFailureFromChecks,
  rollupBusiness,
  rollupBusinesses,
} = require("../dashboard/src/lib/quality/rollup");
const {
  scoreTraceRows,
  listBusinessQuality,
  getBusinessQuality,
  getCallTrace,
  interpretTraceQuery,
  isMissingScoreColumn,
  RELEASE_GAP,
  parseWindowDays,
  parseCallLimit,
} = require("../dashboard/src/lib/quality/assemble");
const { loadVoiceScore, voiceScoreOrigin } = require("../dashboard/src/lib/quality/loadVoiceScore");

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

describe("quality score snapshot", () => {
  const { scoreTurns, cutoffIndicator } = loadVoiceScore();

  it("uses the dashboard snapshot until Voice ships voiceScore.js", () => {
    const origin = voiceScoreOrigin();
    const live = path.join(__dirname, "../src/speech/voiceScore.js");
    if (fs.existsSync(live)) {
      assert.equal(origin.kind, "live");
    } else {
      assert.equal(origin.kind, "snapshot");
    }
  });

  it("matches the phase 1 scorecard on known turns", () => {
    const bad = scoreTurns([
      turn(
        "What services do you offer?",
        "Sawa Alvin, nimeelewa. Kuna huduma yoyote ya usafi ungependa tukusaidie nayo leo?",
        { callerLang: "en", ttsLang: "sw" },
      ),
    ]);
    assert.equal(bad.score, 80);
    assert.equal(bad.checks.languageMismatch, 1);

    const good = scoreTurns([
      turn("Ni huduma gani?", "Tuna usafi wa nyumba.", { callerLang: "sw", ttsLang: "sw" }),
    ]);
    assert.equal(good.score, 100);
    assert.equal(good.checks.languageMismatch, 0);
    assert.equal(good.checks.incomplete, 0);

    const dropped = scoreTurns([
      turn("Jina langu tena?", "", {
        model: "Jina lako ni Alvin.",
        stages: [
          {
            stage: "transform",
            name: "polish",
            dropped: true,
            before: "Jina lako ni Alvin.",
            after: "",
          },
        ],
      }),
    ]);
    assert.equal(dropped.score, 45);
    assert.equal(dropped.checks.deletedAnswer, 1);
    assert.equal(dropped.checks.silence, 1);

    const services = scoreTurns([
      turn("Ni services gani mna offer?", "Ungependa tukuhudumie na gani?", { callerLang: "sw" }),
    ]);
    assert.equal(services.score, 80);
    assert.equal(services.checks.incomplete, 1);

    const names = scoreTurns([
      turn("a", "Je, naongea na Alvin?", { pcm: 400, turnIndex: 1 }),
      turn("b", "Niambie jina lako.", { pcm: 1500, turnIndex: 2 }),
    ]);
    assert.equal(names.nameAsks, 2);
    assert.equal(names.checks.repeatedQuestion, 1);
    assert.equal(names.checks.slow, 1);
    assert.equal(names.score, 87);

    assert.equal(cutoffIndicator("Nataka—"), "trailing_dash");
    const cut = scoreTurns([turn("Nataka—", "Sawa.", { callerLang: "sw" })]);
    assert.equal(cut.checks.prematureTurn, 1);
    assert.equal(cut.score, 90);
  });
});

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
    assert.match(RELEASE_GAP, /Nairobi/);
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
    assert.deepEqual(
      one.releases.map((row) => ({ key: row.key, score: row.score, delta: row.delta, callCount: row.callCount })),
      [
        { key: "sha-old", score: 90, delta: null, callCount: 1 },
        { key: "2026-10-05", score: 60, delta: -30, callCount: 1 },
        { key: "2026-10-06", score: 80, delta: 20, callCount: 1 },
      ],
    );

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
    assert.equal(dropped.droppingReason, "Average fell 20 points versus the prior 7 days.");

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
      "silence showed up on 3 calls and was absent in the prior 7 days.",
    );
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
  const { scoreTurns } = loadVoiceScore();
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

  it("scores stored turns without stripping caller names", () => {
    const spoken = "Tuna usafi wa nyumba.";
    const caller = "Ni huduma gani, Alvin?";
    const rows = [
      row({
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
        },
      }),
      row({
        kind: "turn",
        turnIndex: 1,
        createdAt: "2026-10-07T08:59:30.000Z",
        callId: "HD_shape",
        payload: turn(caller, spoken, { callerLang: "sw", ttsLang: "sw" }),
      }),
    ];

    const scored = scoreTraceRows(rows, scoreTurns);
    assert.equal(scored.length, 1);
    assert.equal(scored[0].score, 100);
    assert.equal(scored[0].release.source, "day");
    assert.equal(scored[0].release.key, "2026-10-07");

    const timeline = getCallTrace({ rows, scoreTurns, diagnoseCall: loadVoiceScore().diagnoseCall });
    assert.equal(timeline.call.score, 100);
    assert.equal(timeline.call.stages[0].text, "Habari Alvin");
    assert.equal(timeline.turns[0].caller.text, caller);
    assert.equal(timeline.turns[0].spoken, spoken);
    assert.equal(timeline.turns[0].outcome, "replay");
    assert.equal(timeline.turns[0].latency.callerStopToFirstTtsPcmMs, null);
    assert.equal(timeline.turns[0].stages.some((stage) => stage.stage === "tts"), true);

    const home = listBusinessQuality({
      rows,
      names: { [tenant]: "Done and Dusted" },
      now: NOW,
      windowDays: 7,
      truncated: false,
      scoreTurns,
      diagnoseCall: loadVoiceScore().diagnoseCall,
    });
    assert.equal(home.ready, true);
    assert.equal(home.businesses[0].businessName, "Done and Dusted");
    assert.equal(home.businesses[0].currentScore, 100);
    assert.match(home.release.gap, /git SHA/);

    const list = getBusinessQuality({
      rows,
      businessId: tenant,
      businessName: "Done and Dusted",
      limit: 30,
      now: NOW,
      scoreTurns,
      diagnoseCall: loadVoiceScore().diagnoseCall,
    });
    assert.equal(list.calls[0].callId, "HD_shape");
    assert.equal(list.calls[0].score, 100);
    assert.equal(list.calls[0].scoreSource, "scored");
    assert.equal(list.dropping, false);
  });

  it("keeps a stored call score when the turns would score higher", () => {
    const spoken = "Tuna usafi wa nyumba.";
    const rows = [
      {
        ...row({
          kind: "call",
          createdAt: "2026-10-07T09:00:00.000Z",
          callId: "HD_stored",
          payload: {
            startedAt: "2026-10-07T08:59:00.000Z",
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
      row({
        kind: "turn",
        turnIndex: 1,
        createdAt: "2026-10-07T08:59:30.000Z",
        callId: "HD_stored",
        payload: turn("Ni huduma gani?", spoken, { callerLang: "sw", ttsLang: "sw" }),
      }),
    ];
    const scored = scoreTraceRows(rows, scoreTurns, loadVoiceScore().diagnoseCall);
    assert.equal(scored[0].score, 41);
    assert.equal(scored[0].scoreSource, "stored");
    assert.equal(scored[0].checks.silence, 2);
    assert.equal(scored[0].diagnosis, "Silence after a caller turn (turns 1)");
    assert.equal(scored[0].release.key, "deadbeef");
    assert.equal(scored[0].release.source, "release");
    assert.equal(scored[0].release.branch, "main");
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
    assert.equal(fs.existsSync(path.join(root, "dashboard/src/app/admin/quality/page.tsx")), false);
    assert.doesNotMatch(read("dashboard/src/lib/quality/voiceScoreSnapshot.js"), /SUPABASE_SERVICE_ROLE_KEY/);
  });
});
