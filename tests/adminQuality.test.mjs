import assert from "node:assert/strict";
import { describe, it } from "node:test";

const qualityUrl = new URL("../dashboard/src/lib/adminQuality.ts", import.meta.url);
const modelUrl = new URL("../dashboard/src/lib/adminQualityModel.ts", import.meta.url);

const { listBusinessQuality, getBusinessQuality, getCallTrace, listReleaseDeltas, qualityBadges, droppingVerdict, releaseDeltasFromCalls } =
  await import(qualityUrl.href);
const {
  callCountLabel,
  couldntAnswerQuestions,
  callToFixture,
  diagnosisLine,
  droppingAttentionRows,
  emptyChecks,
  COULDNT_ANSWER_OUTCOMES,
} = await import(modelUrl.href);

function checks(partial = {}) {
  return { ...emptyChecks(), ...partial };
}

function turn({ text, hit = {}, stages = [], turnIndex = 0 }) {
  return {
    schema: "scalers.voice.turn",
    schemaVersion: 1,
    callId: "HD_test",
    tenantId: "t",
    turnIndex,
    pii: "transcript",
    at: "2026-10-06T09:11:00.000Z",
    voiceId: null,
    caller: { text, language: "sw", confidence: null },
    stages,
    checks: checks(hit),
  };
}

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function sample(daysAgo, score, partial = {}) {
  return { at: new Date(NOW - daysAgo * DAY).toISOString(), score, checks: checks(partial) };
}

function fill(daysAgo, score, count, partial = {}) {
  return Array.from({ length: count }, (_, index) => sample(daysAgo + index * 0.05, score, partial));
}

describe("admin quality seam", () => {
  it("returns empty reads when the service-role client is not configured", async (t) => {
    const configured = Boolean(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
    if (configured) {
      t.skip("service-role client is configured");
      return;
    }
    assert.deepEqual(await listBusinessQuality("7d"), []);
    assert.deepEqual(await listBusinessQuality("30d"), []);
    assert.equal(await getBusinessQuality("biz-dusted", "7d"), null);
    assert.equal(await getCallTrace("HD_dev_low"), null);
    assert.deepEqual(await listReleaseDeltas(), []);
    assert.deepEqual(await qualityBadges(), {});
  });

  it("marks dropping when the 7-day average falls at least 10 with five scored calls each side", () => {
    const dropped = droppingVerdict([...fill(1, 70, 5), ...fill(8, 85, 5)], NOW);
    assert.equal(dropped.dropping, true);
    assert.equal(dropped.droppingReason, "Score fell 15 points in 7 days");

    const exact = droppingVerdict([...fill(1, 70, 5), ...fill(8, 80, 5)], NOW);
    assert.equal(exact.dropping, true);
    assert.equal(exact.droppingReason, "Score fell 10 points in 7 days");

    const small = droppingVerdict([...fill(1, 76, 5), ...fill(8, 85, 5)], NOW);
    assert.equal(small.dropping, false);

    const thin = droppingVerdict([...fill(1, 50, 4), ...fill(8, 90, 5)], NOW);
    assert.equal(thin.dropping, false);

    const unscored = droppingVerdict(
      [...fill(1, 50, 4), sample(1.4, null), ...fill(8, 90, 5)],
      NOW,
    );
    assert.equal(unscored.dropping, false);
  });

  it("marks dropping when a check missing from the prior 7 days hits three calls", () => {
    const fresh = droppingVerdict(
      [...fill(1, 80, 3, { silence: 1 }), ...fill(1.5, 80, 2), ...fill(8, 80, 5)],
      NOW,
    );
    assert.equal(fresh.dropping, true);
    assert.equal(fresh.droppingReason, "Silence on 3 calls");

    const alreadyThere = droppingVerdict(
      [...fill(1, 80, 3, { silence: 1 }), ...fill(8, 80, 1, { silence: 1 }), ...fill(9, 80, 4)],
      NOW,
    );
    assert.equal(alreadyThere.dropping, false);

    const two = droppingVerdict(
      [...fill(1, 80, 2, { silence: 1 }), ...fill(8, 80, 5)],
      NOW,
    );
    assert.equal(two.dropping, false);

    const scoreWins = droppingVerdict(
      [...fill(1, 60, 5, { silence: 1 }), ...fill(8, 80, 5)],
      NOW,
    );
    assert.equal(scoreWins.droppingReason, "Score fell 20 points in 7 days");
  });

  it("compares a release with the calls on the side before it", () => {
    const deltas = releaseDeltasFromCalls([
      {
        at: "2026-10-01T00:00:00.000Z",
        score: 40,
        checks: checks({ silence: 2 }),
        release: { gitSha: "aaa", branch: "main", label: "Before" },
      },
      {
        at: "2026-10-02T00:00:00.000Z",
        score: 60,
        checks: checks({ silence: 1 }),
        release: { gitSha: "bbb", branch: "main", label: "After" },
      },
    ]);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].release.label, "After");
    assert.equal(deltas[0].before.avgScore, 40);
    assert.equal(deltas[0].after.avgScore, 60);
    assert.equal(deltas[0].before.checks.silence, 2);
    assert.equal(deltas[0].after.checks.silence, 1);
    assert.deepEqual(
      releaseDeltasFromCalls([
        {
          at: "2026-10-07T00:00:00.000Z",
          score: 66.5,
          checks: checks(),
          release: { gitSha: "only", branch: "main", label: "" },
        },
      ]),
      [],
    );
  });

  it("pluralizes a traced-call count", () => {
    assert.equal(callCountLabel(0), "0 calls");
    assert.equal(callCountLabel(1), "1 call");
    assert.equal(callCountLabel(5), "5 calls");
  });

  it("keeps Couldn't answer outcomes behind one constant", () => {
    assert.deepEqual(COULDNT_ANSWER_OUTCOMES, ["unknown", "escalation"]);
  });

  it("dedupes Couldn't answer by caller question", () => {
    const questions = couldntAnswerQuestions([
      turn({
        text: "Unafanya huduma gani?",
        hit: { incomplete: 1, deletedAnswer: 1 },
        turnIndex: 0,
      }),
      turn({
        text: "  unafanya   huduma gani? ",
        hit: { silence: 1 },
        stages: [{ stage: "canned", path: "llm_recovery", text: "Sema tena." }],
        turnIndex: 1,
      }),
      turn({
        text: "Naweza kuja kesho?",
        stages: [{ stage: "outcome", value: "UNKNOWN" }],
        turnIndex: 2,
      }),
      turn({
        text: "Ni Alvin.",
        stages: [{ stage: "outcome", value: "Escalation" }],
        turnIndex: 3,
      }),
      turn({
        text: "Asante, hiyo inatosha.",
        stages: [{ stage: "outcome", value: "ok" }],
        turnIndex: 4,
      }),
      turn({
        text: "   ",
        hit: { silence: 1 },
        turnIndex: 5,
      }),
      turn({
        text: "Habari",
        stages: [{ stage: "canned", path: "greeting", text: "Habari." }],
        turnIndex: 6,
      }),
      {
        ...turn({
          text: "Bei gani?",
          stages: [{ stage: "outcome", value: "unknown" }],
          turnIndex: 7,
        }),
        checks: undefined,
      },
    ]);

    assert.deepEqual(questions, ["Unafanya huduma gani?", "Naweza kuja kesho?", "Ni Alvin.", "Bei gani?"]);
  });

  it("uses the persisted diagnosis, then the top check", () => {
    assert.equal(diagnosisLine({ diagnosis: "Name asked twice", checks: checks({ silence: 3 }) }), "Name asked twice");
    assert.equal(diagnosisLine({ diagnosis: null, checks: checks({ silence: 1, slow: 4 }) }), "Slow reply");
    assert.equal(diagnosisLine({ diagnosis: "  ", checks: checks() }), "No failing checks");
  });

  it("lists only dropping businesses, with the reason as the row text", () => {
    const rows = droppingAttentionRows(
      {
        a: { score: 40, dropping: true, droppingReason: "Score fell 22 points in 7 days" },
        b: { score: 90, dropping: false, droppingReason: "" },
      },
      [
        { id: "a", name: "Done and Dusted" },
        { id: "b", name: "Esga Stationery" },
      ],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Done and Dusted");
    assert.equal(rows[0].detail, "Score fell 22 points in 7 days");
    assert.equal(rows[0].stamp, "Dropping");
    assert.equal(rows[0].href, "/admin/quality/a");
  });

  it("saves a call as a voice-calls fixture without stages", () => {
    const fixture = callToFixture({
      schema: "scalers.voice.call",
      schemaVersion: 1,
      callId: "HD_test",
      tenantId: "t",
      businessId: "biz",
      businessName: "Done and Dusted",
      startedAt: "2026-10-06T09:11:00.000Z",
      endedAt: null,
      turnCount: 1,
      voiceId: null,
      sttModel: null,
      ttsModel: null,
      greeting: [],
      score: 38,
      checks: checks({ silence: 1 }),
      diagnosis: null,
      release: null,
      turns: [
        turn({
          text: "Unafanya huduma gani?",
          stages: [
            {
              stage: "model",
              phase: "output",
              provider: "gemini",
              model: "recorded",
              promptId: "voice.system",
              outputText: "Tunaosha sofa.",
              chars: 14,
              spokenEmitted: 5,
            },
            { stage: "canned", path: "llm_recovery", text: "Sema tena." },
            { stage: "latency", callerStopToModelFirstTokenMs: 400, callerStopToFirstTtsPcmMs: 1640 },
            { stage: "turn_end", decision: "flush", reason: "endpoint" },
          ],
        }),
      ],
    });
    assert.equal(fixture.schema, "scalers.voice.fixture");
    assert.equal(fixture.schemaVersion, 1);
    assert.equal(fixture.turns.length, 1);
    assert.equal(fixture.turns[0].caller, "Unafanya huduma gani?");
    assert.equal(fixture.turns[0].flushed, true);
    assert.equal(fixture.turns[0].model.outputText, "Tunaosha sofa.");
    assert.deepEqual(fixture.turns[0].canned, { path: "llm_recovery", text: "Sema tena." });
    assert.deepEqual(fixture.turns[0].observed, { firstPcmMs: 1640 });
    assert.equal("stages" in fixture.turns[0], false);
  });
});
