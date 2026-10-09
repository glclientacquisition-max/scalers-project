import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// A stand-in PostgREST so the real reader and supabase-js run end to end.
let mode = "ok";
const seen = [];
const RECENT = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const TENANT = "df4ad9d8-28ff-4810-b1e6-94f5495472b0";

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const select = url.searchParams.get("select") || "";
  seen.push({ mode, path: url.pathname, select });
  if (url.pathname.endsWith("/tenants")) {
    return send(res, 200, [{ id: TENANT, business_name: "Done and Dusted Cleaning Services" }]);
  }
  if (url.pathname.endsWith("/calls")) return send(res, 200, []);
  if (!url.pathname.endsWith("/voice_turn_traces")) return send(res, 404, { message: "not found" });
  if (mode === "missing-table") {
    return send(res, 404, {
      code: "PGRST205",
      details: null,
      hint: null,
      message: "Could not find the table 'public.voice_turn_traces' in the schema cache",
    });
  }
  if (mode === "missing-columns" && /\bscore\b/.test(select)) {
    return send(res, 400, { code: "42703", details: null, hint: null, message: "column voice_turn_traces.score does not exist" });
  }
  if (mode === "broken") return send(res, 500, { code: "XX000", message: "connection reset" });
  if (url.searchParams.get("record_kind") === "eq.call") {
    return send(res, 200, [
      {
        call_id: "HD_0789461c5319",
        tenant_id: TENANT,
        turn_index: null,
        record_kind: "call",
        pii: "transcript",
        created_at: RECENT,
        payload: { callId: "HD_0789461c5319", startedAt: RECENT, score: 66.5 },
      },
    ]);
  }
  return send(res, 200, []);
});

let quality;
let model;
let rollup;

before(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  delete process.env.NEXT_RUNTIME;
  quality = await import(new URL("../dashboard/src/lib/adminQuality.ts", import.meta.url).href);
  model = await import(new URL("../dashboard/src/lib/adminQualityModel.ts", import.meta.url).href);
  rollup = require("../dashboard/src/lib/quality/rollup.js");
});

after(() => server.close());

async function quietly(fn) {
  const original = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  try {
    return { value: await fn(), logged };
  } finally {
    console.error = original;
  }
}

function checks(partial = {}) {
  return { ...model.emptyChecks(), ...partial };
}

function turn({ text, hit, stages = [], turnIndex = 0 }) {
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
    checks: hit ? checks(hit) : null,
  };
}

describe("Overview and Businesses survive Quality failures", () => {
  it("returns no badges when the trace table is missing", async () => {
    mode = "missing-table";
    assert.deepEqual(await quality.qualityBadges(), {});
    assert.deepEqual(await quality.listBusinessQuality("7d"), []);
    assert.equal(await quality.getBusinessQuality(TENANT, "7d"), null);
    assert.equal(await quality.getCallTrace("HD_0789461c5319"), null);
    assert.deepEqual(await quality.listReleaseDeltas(), []);
  });

  it("falls back to base columns when score columns are missing", async () => {
    mode = "missing-columns";
    seen.length = 0;
    const badges = await quality.qualityBadges();
    assert.deepEqual(badges, { [TENANT]: { score: 66.5, dropping: false, droppingReason: "" } });
    const traceReads = seen.filter((row) => row.path.endsWith("/voice_turn_traces"));
    assert.equal(traceReads.length, 2);
    assert.match(traceReads[0].select, /score/);
    assert.doesNotMatch(traceReads[1].select, /score/);
  });

  it("logs and returns empty badges when the reader throws, so the page still loads", async () => {
    mode = "broken";
    await assert.rejects(quality.qualityBadges());
    const { value, logged } = await quietly(() =>
      Promise.all([Promise.resolve("overview"), quality.qualityBadges().catch(quality.noQualityBadges("overview:quality"))]),
    );
    assert.deepEqual(value, ["overview", {}]);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /\[admin:overview:quality\]/);
  });

  it("wraps qualityBadges in the catch on both pages", () => {
    for (const rel of ["dashboard/src/app/admin/(console)/page.tsx", "dashboard/src/app/admin/(console)/businesses/page.tsx"]) {
      const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert.match(source, /qualityBadges\(\)\.catch\(noQualityBadges\("[a-z]+:quality"\)\)/, rel);
      assert.doesNotMatch(source, /qualityBadges\(\),/, rel);
    }
  });

  it("reads a live row with a stored score", async () => {
    mode = "ok";
    const rows = await quality.listBusinessQuality("7d");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Done and Dusted Cleaning Services");
    assert.equal(rows[0].score, 66.5);
    assert.equal(rows[0].checksLogged, false);
    assert.equal(rows[0].topFailure, null);
  });
});

describe("one Quality reader", () => {
  it("keeps every voice_turn_traces read in quality/readQuality.ts", () => {
    const hits = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|js)$/.test(entry.name) && /from\("voice_turn_traces"\)/.test(fs.readFileSync(full, "utf8"))) {
          hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(path.join(ROOT, "dashboard/src"));
    assert.deepEqual(hits, ["dashboard/src/lib/quality/readQuality.ts"]);
    const seam = fs.readFileSync(path.join(ROOT, "dashboard/src/lib/adminQuality.ts"), "utf8");
    assert.doesNotMatch(seam, /getSupabaseAdmin|droppingVerdict|DROP_POINTS|WEEK_MS/);
    assert.match(seam, /from "\.\/quality\/readQuality"/);
  });

  it("uses the same check words as the rollup that writes Dropping reasons", () => {
    assert.deepEqual(model.CHECK_LABELS, rollup.CHECK_LABELS);
  });
});

describe("release before/after", () => {
  const group = (gitSha, score, firstCallAt, label = null, checksBody = {}) => ({
    key: gitSha || firstCallAt,
    gitSha,
    branch: "main",
    label,
    firstCallAt,
    score,
    checks: checksBody,
  });

  it("pairs consecutive releases, newest first, and skips groups with no SHA", () => {
    const deltas = quality.releaseDeltasFromGroups([
      group("aaa", 40, "2026-10-01T00:00:00.000Z", "Before", { silence: 2 }),
      group(null, 99, "2026-10-02T00:00:00.000Z"),
      group("bbb", 60, "2026-10-03T00:00:00.000Z", null, { silence: 1 }),
    ]);
    assert.equal(deltas.length, 1);
    assert.equal(deltas[0].release.gitSha, "bbb");
    assert.equal(deltas[0].before.avgScore, 40);
    assert.equal(deltas[0].after.avgScore, 60);
    assert.equal(deltas[0].before.checks.silence, 2);
    assert.equal(deltas[0].after.checks.silence, 1);
    assert.equal(model.releaseName(deltas[0]), "Release of 3 Oct");
    assert.deepEqual(quality.releaseDeltasFromGroups([group("only", 66.5, "2026-10-07T00:00:00.000Z")]), []);
  });

  it("names a release by its label, never by the SHA", () => {
    const name = model.releaseName({ release: { gitSha: "a1b2c3d4e5", branch: "main", label: "Mouth filters" }, at: null });
    assert.equal(name, "Mouth filters");
    assert.equal(model.releaseName({ release: { gitSha: "a1b2c3d4e5", branch: "main", label: "" }, at: null }), "Release");
  });
});

describe("Quality view model", () => {
  it("pluralizes a traced-call count", () => {
    assert.equal(model.callCountLabel(0), "0 calls");
    assert.equal(model.callCountLabel(1), "1 call");
    assert.equal(model.callCountLabel(5), "5 calls");
  });

  it("keeps Couldn't answer literals behind constants", () => {
    assert.deepEqual(model.COULDNT_ANSWER_OUTCOMES, ["unknown", "escalation"]);
    assert.deepEqual(model.COULDNT_ANSWER_CANNED, ["llm_recovery"]);
  });

  it("counts only unknown, escalation, and the recovery line as Couldn't answer", () => {
    const questions = model.couldntAnswerQuestions([
      turn({ text: "Unafanya huduma gani?", hit: { incomplete: 1, deletedAnswer: 1 }, turnIndex: 0 }),
      turn({ text: "Mko wapi?", hit: { silence: 1 }, turnIndex: 1 }),
      turn({
        text: "  unafanya   huduma gani? ",
        stages: [{ stage: "canned", path: "llm_recovery", text: "Sema tena." }],
        turnIndex: 2,
      }),
      turn({ text: "Naweza kuja kesho?", stages: [{ stage: "outcome", value: "UNKNOWN" }], turnIndex: 3 }),
      turn({ text: "Ni Alvin.", stages: [{ stage: "outcome", value: "Escalation" }], turnIndex: 4 }),
      turn({ text: "Asante, hiyo inatosha.", stages: [{ stage: "outcome", value: "ok" }], turnIndex: 5 }),
      turn({ text: "   ", stages: [{ stage: "outcome", value: "unknown" }], turnIndex: 6 }),
      turn({ text: "Habari", stages: [{ stage: "canned", path: "greeting", text: "Habari." }], turnIndex: 7 }),
      turn({ text: "Bei gani?", stages: [{ stage: "outcome", value: "unknown" }], turnIndex: 8 }),
    ]);
    assert.deepEqual(questions, ["unafanya   huduma gani?", "Naweza kuja kesho?", "Ni Alvin.", "Bei gani?"]);
  });

  it("shows the stored diagnosis, and Not scored when Voice stored none", () => {
    assert.equal(model.diagnosisLine({ diagnosis: "Name asked twice", checks: checks({ silence: 3 }) }), "Name asked twice");
    assert.equal(model.diagnosisLine({ diagnosis: null, checks: checks({ silence: 1, slow: 4 }) }), "Not scored");
    assert.equal(model.diagnosisLine({ diagnosis: null, checks: checks() }), "Not scored");
    assert.equal(model.diagnosisLine({ diagnosis: "  ", checks: null }), "Not scored");
    assert.notEqual(model.diagnosisLine({ diagnosis: null, checks: checks() }), "No failing checks");
  });

  it("does not count calls with no stored checks as repeat failures", () => {
    const repeats = model.repeatFailuresFromCalls([
      { checks: checks({ silence: 1 }) },
      { checks: null },
      { checks: checks({ silence: 2 }) },
    ]);
    assert.deepEqual(repeats, [{ check: "silence", calls: 2 }]);
  });

  it("lists only dropping businesses, with the reason as the row text", () => {
    const rows = model.droppingAttentionRows(
      {
        a: { score: 40, dropping: true, droppingReason: "Score fell 22 points versus the prior 7 days." },
        b: { score: 90, dropping: false, droppingReason: "" },
      },
      [
        { id: "a", name: "Done and Dusted" },
        { id: "b", name: "Esga Stationery" },
      ],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Done and Dusted");
    assert.equal(rows[0].detail, "Score fell 22 points versus the prior 7 days.");
    assert.equal(rows[0].stamp, "Dropping");
    assert.equal(rows[0].href, "/admin/quality/a");
  });

  it("saves a call as a fixture and writes null for anything the trace did not store", () => {
    const call = {
      schema: "scalers.voice.call",
      schemaVersion: 1,
      callId: "HD_test",
      tenantId: "t",
      businessId: "biz",
      businessName: "Done and Dusted",
      startedAt: "2026-10-06T09:11:00.000Z",
      endedAt: null,
      turnCount: 2,
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
            { stage: "model", phase: "output", outputText: "Tunaosha sofa.", chars: 14, spokenEmitted: 5 },
            { stage: "canned", path: "llm_recovery", text: "Sema tena." },
            { stage: "latency", callerStopToModelFirstTokenMs: 400, callerStopToFirstTtsPcmMs: 1640 },
            { stage: "turn_end", decision: "flush", reason: "endpoint" },
          ],
        }),
        turn({ text: "Sawa", turnIndex: 1 }),
      ],
    };
    const fixture = model.callToFixture(call);
    assert.equal(fixture.schema, "scalers.voice.fixture");
    assert.equal(fixture.turns.length, 2);
    assert.equal(fixture.turns[0].caller, "Unafanya huduma gani?");
    assert.equal(fixture.turns[0].flushed, true);
    assert.equal(fixture.turns[0].model.outputText, "Tunaosha sofa.");
    assert.deepEqual(fixture.turns[0].canned, { path: "llm_recovery", text: "Sema tena." });
    assert.deepEqual(fixture.turns[0].observed, { firstPcmMs: 1640 });
    assert.equal("stages" in fixture.turns[0], false);
    for (const row of fixture.turns) {
      assert.equal(row.model.provider, null);
      assert.equal(row.model.model, null);
      assert.equal(row.model.promptId, null);
    }
    assert.doesNotMatch(JSON.stringify(fixture), /gemini|recorded|voice\.system/);
  });

  it("prefers persisted detected language and falls back to the language stage", () => {
    const staged = turn({
      text: "Habari",
      stages: [{ stage: "language", detected: "unknown", sticky: "en", confidence: 0.4 }],
    });
    assert.equal(model.languageLine(staged), "Detected unknown. Sticky en.");
    assert.equal(
      model.languageLine({ ...staged, caller: { ...staged.caller, detected: "sw", sticky: "en" } }),
      "Detected sw. Sticky en.",
    );
    const bare = turn({ text: "Habari", stages: [] });
    assert.equal(model.languageLine(bare), "Not logged");
    assert.deepEqual(model.fillerLines(bare), []);
    assert.deepEqual(model.toolLines(bare), []);
  });

  it("says Played only when the filler stored played true", () => {
    const pinned = turn({
      text: "Mnatosha nyumba?",
      stages: [
        { stage: "filler", text: "Mm-hmm", before: "Mm-hmm.", language: "sw", played: true },
        { stage: "filler", text: "", before: "", language: "sw", played: false },
        { stage: "filler", text: "Sawa", before: "Sawa.", language: "sw" },
        { stage: "tool", name: "save_caller_info", status: "succeeded", args: "name=Alvin" },
        { stage: "tool", name: "create_service_request", status: "consent_blocked", args: "" },
        { stage: "tool", name: "file_lookup", status: "", args: "" },
      ],
    });
    assert.deepEqual(model.fillerLines(pinned), ["Played. Mm-hmm", "Not played", "Not logged. Sawa"]);
    assert.deepEqual(model.toolLines(pinned), [
      "save_caller_info. Ok",
      "create_service_request. Failed",
      "file_lookup. Not logged",
    ]);
  });

  it("keeps vendor and model names out of the Raw view", () => {
    const shown = model.screenStages([
      { stage: "model", phase: "output", provider: "x", model: "y", outputText: "Sawa." },
      { stage: "tts", text: "Sawa.", voiceId: "v" },
    ]);
    assert.deepEqual(shown, [
      { stage: "model", phase: "output", outputText: "Sawa." },
      { stage: "tts", text: "Sawa." },
    ]);
  });

  it("shows plain labels on the call screen", () => {
    const call = fs.readFileSync(path.join(ROOT, "dashboard/src/components/admin/QualityCall.tsx"), "utf8");
    assert.match(call, /label="Model output"/);
    assert.match(call, /label="Heard"/);
    assert.doesNotMatch(call, /Gemini|STT heard|shortSha|gitSha/);
    const index = fs.readFileSync(path.join(ROOT, "dashboard/src/components/admin/QualityIndex.tsx"), "utf8");
    assert.doesNotMatch(index, /shortSha|>\{row\.release\.gitSha\}</);
  });

  it("opens phone More as a bottom Sheet, not a popover menu", () => {
    const nav = fs.readFileSync(path.join(ROOT, "dashboard/src/components/AdminNav.tsx"), "utf8");
    assert.match(nav, /from "@\/components\/ui\/Sheet"/);
    assert.doesNotMatch(nav, /components\/ui\/Menu"/);
    assert.match(nav, /aria-haspopup="dialog"/);
  });
});
