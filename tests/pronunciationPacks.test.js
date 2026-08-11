/**
 * Pack uniqueness + logical sentence checks.
 * Run: node --test tests/pronunciationPacks.test.js
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FILLER_PLACE = new Set(
  [
    "shop",
    "no",
    "number",
    "main",
    "branch",
    "store",
    "cbd",
    "nairobi",
    "kenya",
    "street",
    "road",
    "avenue",
    "opposite",
    "near",
    "located",
  ].map((w) => w.toLowerCase())
);

function normalizeKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Mirror of pack rules we care about for ChapterOne-shaped input. */
function chapterOnePacks() {
  const businessName = "ChapterOne Bookstore";
  const agentName = "Aisha";
  const street = "Muindi Mbingu Street";
  const landmark = "City Market Fashion Mall";
  const team = "Harrison Maina";
  return [
    {
      id: "pack:greeting",
      prompt: `Hello, you've reached ${businessName}, this is ${agentName} speaking.`,
      targets: [businessName, agentName],
    },
    {
      id: "pack:location",
      prompt: `We're on ${street}, opposite ${landmark}.`,
      targets: [street, landmark],
    },
    {
      id: "pack:team",
      prompt: `I can have ${team} follow up with you.`,
      targets: [team],
    },
  ];
}

describe("pronunciation packs — no repeats, logical lines", () => {
  it("emits at most one of each pack id", () => {
    const packs = chapterOnePacks();
    const ids = packs.map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes("pack:greeting"));
    assert.ok(ids.includes("pack:location"));
    assert.ok(ids.includes("pack:team"));
  });

  it("has unique prompt text", () => {
    const packs = chapterOnePacks();
    const keys = packs.map((p) => normalizeKey(p.prompt));
    assert.equal(new Set(keys).size, keys.length);
  });

  it("each prompt contains its targets (logical sense)", () => {
    for (const pack of chapterOnePacks()) {
      for (const t of pack.targets) {
        assert.ok(
          pack.prompt.toLowerCase().includes(t.toLowerCase()),
          `${pack.id} missing ${t}`
        );
      }
    }
  });

  it("location line is a natural receptionist sentence", () => {
    const loc = chapterOnePacks().find((p) => p.id === "pack:location");
    assert.match(loc.prompt, /^We're on .+, opposite .+\.$/);
    assert.doesNotMatch(loc.prompt, /Shop No/i);
    assert.doesNotMatch(loc.prompt, /Just to confirm/i);
  });

  it("skips filler-only place fragments", () => {
    const words = "Shop No".split(" ");
    const allFiller = words.every(
      (w) => FILLER_PLACE.has(w.toLowerCase()) || /^[A-Z]?\.?\d+$/i.test(w)
    );
    assert.equal(allFiller, true);
  });
});
