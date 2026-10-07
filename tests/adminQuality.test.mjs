import assert from "node:assert/strict";
import { describe, it } from "node:test";

const qualityUrl = new URL("../dashboard/src/lib/adminQuality.ts", import.meta.url);
const modelUrl = new URL("../dashboard/src/lib/adminQualityModel.ts", import.meta.url);

const { listBusinessQuality, getBusinessQuality, getCallTrace, listReleaseDeltas, qualityBadges } =
  await import(qualityUrl.href);
const { couldntAnswerQuestions, callToFixture, diagnosisLine, droppingAttentionRows, emptyChecks } =
  await import(modelUrl.href);

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

describe("admin quality seam", () => {
  it("returns empty reads until Platform wires service-role traces", async () => {
    assert.deepEqual(await listBusinessQuality("7d"), []);
    assert.deepEqual(await listBusinessQuality("30d"), []);
    assert.equal(await getBusinessQuality("biz-dusted", "7d"), null);
    assert.equal(await getCallTrace("HD_dev_low"), null);
    assert.deepEqual(await listReleaseDeltas(), []);
    assert.deepEqual(await qualityBadges(), {});
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
    ]);

    assert.deepEqual(questions, ["Unafanya huduma gani?", "Naweza kuja kesho?", "Ni Alvin."]);
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
