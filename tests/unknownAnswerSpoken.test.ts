import assert from "node:assert/strict";
import test from "node:test";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  UNKNOWN_ANSWER_DEFAULT_SW,
  localSpokenLines,
  ownerUnknownAnswer,
  planUnknownAnswerSave,
  resolveUnknownAnswerSpoken,
  sanitizeSpokenLine,
  unknownAnswerBoxText,
} from "../dashboard/src/lib/unknownAnswerSpoken";
import { generateUnknownAnswerSpoken } from "../dashboard/src/lib/unknownAnswerSpokenModel";

const NOW = "2026-10-18T18:00:00.000Z";

test("sanitizer strips transfers, confirmed bookings, and specific times", () => {
  assert.equal(
    sanitizeSpokenLine("I will transfer you to the owner.", "en"),
    UNKNOWN_ANSWER_DEFAULT_EN
  );
  assert.equal(
    sanitizeSpokenLine("I'll connect you with the shop.", "en"),
    UNKNOWN_ANSWER_DEFAULT_EN
  );
  assert.equal(
    sanitizeSpokenLine("Your booking is confirmed for 3pm.", "en"),
    UNKNOWN_ANSWER_DEFAULT_EN
  );
  assert.equal(
    sanitizeSpokenLine("Someone from the shop will call you back today.", "en"),
    "Someone from the shop will call you back."
  );
  assert.equal(
    sanitizeSpokenLine("Someone will call you in 5 minutes.", "en"),
    "Someone will call you."
  );
  assert.equal(
    sanitizeSpokenLine("We will call you within the hour.", "en"),
    "We will call you."
  );
  assert.equal(
    sanitizeSpokenLine("Your BA will call you back.", "en"),
    "Your Business Assistant will call you back."
  );
  assert.equal(
    sanitizeSpokenLine("Nitakupigia leo.", "sw"),
    "Nitakupigia."
  );
  assert.equal(
    sanitizeSpokenLine("Nikuunganishe na meneja.", "sw"),
    UNKNOWN_ANSWER_DEFAULT_SW
  );
});

test("an empty field stores null", async () => {
  let called = false;
  const spoken = await resolveUnknownAnswerSpoken({
    fallback: "   ",
    stored: {
      en: "Keep me",
      sw: "Usinifute",
      source: "old",
      updated_at: NOW,
    },
    generate: async () => {
      called = true;
      return { en: "no", sw: "hapana" };
    },
  });
  assert.equal(spoken, null);
  assert.equal(called, false);
});

test("voice lines stay when source matches, and a new line regenerates", async () => {
  const stored = {
    en: "A teammate will call you back.",
    sw: "Mwenzetu atakupigia.",
    source: "We will confirm that.",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
  const kept = await resolveUnknownAnswerSpoken({
    fallback: "We will confirm that.",
    stored,
    editedEn: "Ignore this edit",
    editedSw: "Puuza",
    touched: false,
    generate: async () => {
      throw new Error("should not call the model when source matches");
    },
  });
  assert.deepEqual(kept, stored);

  const regenerated = await resolveUnknownAnswerSpoken({
    fallback: "Ask the owner to call them.",
    stored,
    editedEn: "Ignore this edit",
    now: NOW,
    generate: async () => ({
      en: "I will connect you today.",
      sw: "Nikuunganishe leo.",
    }),
  });
  assert.equal(regenerated?.source, "Ask the owner to call them.");
  assert.equal(regenerated?.en, UNKNOWN_ANSWER_DEFAULT_EN);
  assert.equal(regenerated?.sw, UNKNOWN_ANSWER_DEFAULT_SW);
  assert.equal(regenerated?.updated_at, NOW);
  assert.notEqual(regenerated?.en, "Ignore this edit");
});

test("an edit of the spoken lines keeps source", async () => {
  const stored = {
    en: "A teammate will call you back.",
    sw: UNKNOWN_ANSWER_DEFAULT_SW,
    source: "We will confirm that.",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
  const edited = await resolveUnknownAnswerSpoken({
    fallback: "We will confirm that.",
    stored,
    touched: true,
    editedEn: "Call the owner back.",
    editedSw: "",
    now: NOW,
    generate: async () => {
      throw new Error("an edit must not regenerate");
    },
  });
  assert.equal(edited?.source, "We will confirm that.");
  assert.equal(edited?.en, "Call the owner back.");
  assert.equal(edited?.sw, UNKNOWN_ANSWER_DEFAULT_SW);
  assert.equal(edited?.updated_at, NOW);
});

test("the fallback works with no model", async () => {
  const previous = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(await generateUnknownAnswerSpoken("Someone from the shop will call you back today."), null);
    const spoken = await resolveUnknownAnswerSpoken({
      fallback: "Someone from the shop will call you back today. I'll transfer you.",
      now: NOW,
      generate: generateUnknownAnswerSpoken,
    });
    assert.deepEqual(spoken, {
      en: "Someone from the shop will call you back.",
      sw: UNKNOWN_ANSWER_DEFAULT_SW,
      source: "Someone from the shop will call you back today. I'll transfer you.",
      updated_at: NOW,
    });
    assert.deepEqual(localSpokenLines("Your BA will call you back in 5 minutes."), {
      en: "Your Business Assistant will call you back.",
      sw: UNKNOWN_ANSWER_DEFAULT_SW,
    });
  } finally {
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
  }
});

const neverCalled = async () => {
  throw new Error("the default must not reach the model");
};

test("with nothing stored, the box shows the team default and an unedited save stays null", async () => {
  assert.equal(unknownAnswerBoxText(null), UNKNOWN_ANSWER_DEFAULT_EN);
  assert.equal(unknownAnswerBoxText(""), UNKNOWN_ANSWER_DEFAULT_EN);
  assert.equal(ownerUnknownAnswer(UNKNOWN_ANSWER_DEFAULT_EN), "");
  assert.equal(ownerUnknownAnswer(`  ${UNKNOWN_ANSWER_DEFAULT_EN.toLowerCase()} `), "");
  assert.equal(ownerUnknownAnswer(UNKNOWN_ANSWER_DEFAULT_SW), "");

  const plan = await planUnknownAnswerSave({
    submitted: unknownAnswerBoxText(null),
    storedSpoken: null,
    generate: neverCalled,
  });
  assert.deepEqual(plan, { unknown_answer_fallback: null, unknown_answer_spoken: null });
});

test("an owner edit is stored and rewritten for callers", async () => {
  const line = "If we do not stock it, a teammate will call you back today.";
  let asked = "";
  const plan = await planUnknownAnswerSave({
    submitted: `  ${line}  `,
    storedSpoken: null,
    now: NOW,
    generate: async (source) => {
      asked = source;
      return {
        en: "If we do not stock it, a teammate will call you back today.",
        sw: "Tukikosa bidhaa hiyo, mwenzetu atakupigia leo.",
      };
    },
  });
  assert.equal(asked, line);
  assert.equal(plan.unknown_answer_fallback, line);
  assert.deepEqual(plan.unknown_answer_spoken, {
    en: "If we do not stock it, a teammate will call you back.",
    sw: "Tukikosa bidhaa hiyo, mwenzetu atakupigia.",
    source: line,
    updated_at: NOW,
  });
  assert.equal(unknownAnswerBoxText(plan.unknown_answer_fallback), line);
});

test("Reset to default clears both columns back to null", async () => {
  const stored = {
    en: "If we do not stock it, a teammate will call you back.",
    sw: "Tukikosa bidhaa hiyo, mwenzetu atakupigia.",
    source: "If we do not stock it, a teammate will call you back today.",
    updated_at: NOW,
  };
  for (const submitted of [UNKNOWN_ANSWER_DEFAULT_EN, "", "   "]) {
    const plan = await planUnknownAnswerSave({
      submitted,
      storedSpoken: stored,
      editedEn: stored.en,
      editedSw: stored.sw,
      touched: true,
      generate: neverCalled,
    });
    assert.deepEqual(plan, { unknown_answer_fallback: null, unknown_answer_spoken: null });
  }
  assert.equal(unknownAnswerBoxText(null), UNKNOWN_ANSWER_DEFAULT_EN);
});

test("Settings opens on the default, never writes it, and offers Reset to default", async () => {
  const { readFileSync } = await import("node:fs");
  const form = readFileSync(new URL("../dashboard/src/components/TenantForm.tsx", import.meta.url), "utf8");
  const field = readFileSync(new URL("../dashboard/src/components/UnknownAnswerField.tsx", import.meta.url), "utf8");
  const save = readFileSync(new URL("../dashboard/src/app/(desk)/settings/actions.ts", import.meta.url), "utf8");
  const setup = readFileSync(new URL("../dashboard/src/app/onboarding/setupActions.ts", import.meta.url), "utf8");
  const onboarding = readFileSync(new URL("../dashboard/src/app/onboarding/actions.ts", import.meta.url), "utf8");

  assert.match(form, /useState\(\(\) => unknownAnswerBoxText\(tenant\.unknown_answer_fallback\)\)/);
  assert.match(form, /name="unknown_answer_fallback" value=\{unknownLine\}/);
  assert.match(field, />\s*Default\s*</);
  assert.match(field, /Reset to default/);
  assert.match(save, /planUnknownAnswerSave\(/);
  for (const src of [form, field, save, setup, onboarding]) {
    assert.doesNotMatch(src, /call you back today/i);
    assert.doesNotMatch(src, /I'll check with the owner/);
  }
  assert.doesNotMatch(setup, /unknown_answer_fallback:/);
  assert.doesNotMatch(onboarding, /unknown_answer_fallback:/);
});
