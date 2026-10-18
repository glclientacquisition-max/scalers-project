import assert from "node:assert/strict";
import test from "node:test";
import {
  UNKNOWN_ANSWER_DEFAULT_EN,
  UNKNOWN_ANSWER_DEFAULT_SW,
  localSpokenLines,
  resolveUnknownAnswerSpoken,
  sanitizeSpokenLine,
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
    sanitizeSpokenLine("A teammate will call you back today.", "en"),
    "A teammate will call you back."
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
    assert.equal(await generateUnknownAnswerSpoken("A teammate will call you back today."), null);
    const spoken = await resolveUnknownAnswerSpoken({
      fallback: "A teammate will call you back today. I'll transfer you.",
      now: NOW,
      generate: generateUnknownAnswerSpoken,
    });
    assert.deepEqual(spoken, {
      en: "A teammate will call you back.",
      sw: UNKNOWN_ANSWER_DEFAULT_SW,
      source: "A teammate will call you back today. I'll transfer you.",
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
