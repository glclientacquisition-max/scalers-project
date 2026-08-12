#!/usr/bin/env node
/**
 * End-to-end verification of Pronunciation studio helpers (no browser).
 * Mirrors Practice / Library / Fix flows for ChapterOne-shaped data.
 *
 * Run from repo root:
 *   npx tsx --tsconfig dashboard/tsconfig.json scripts/verify-pronunciation-studio.ts
 */
import assert from "node:assert/strict";
import {
  displayLexiconLabel,
  isBlockedMatch,
  lexiconForStorage,
  matchPatternFromPhrase,
  mergeLexiconEntry,
  parseTtsLexicon,
  sanitizeSayForm,
} from "../dashboard/src/lib/pronunciationLexicon.ts";
import {
  collectKnownPronunciationHints,
  customTrainingLine,
  mineSuggestionsFromAgentLines,
} from "../dashboard/src/lib/pronunciationMine.ts";
import {
  buildPronunciationPacks,
  previewSpokenLine,
} from "../dashboard/src/lib/pronunciationPacks.ts";
import { isPronunciationCovered } from "../dashboard/src/lib/pronunciationSuggest.ts";

const chapterOne = {
  businessName: "ChapterOne Bookstore",
  agentName: "Aisha",
  locations: [
    {
      label: "Nairobi CBD",
      address: "Muindi Mbingu Street, Shop No. M4, Nairobi CBD",
      landmark: "opposite City Market Fashion Mall",
      directions: "",
    },
  ],
  team: [{ name: "Harrison Maina", role: "Owner" }],
};

const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("OK  ", name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${msg}`);
    console.log("FAIL", name, "—", msg);
  }
}

check("Practice packs: greeting + location + team", () => {
  const packs = buildPronunciationPacks({ ...chapterOne, existingLexicon: [] });
  assert.equal(packs.length, 3);
  assert.ok(packs.some((p) => p.id === "pack:greeting"));
  assert.ok(packs.some((p) => p.id === "pack:location"));
  assert.ok(packs.some((p) => p.id === "pack:team"));
  const loc = packs.find((p) => p.id === "pack:location")!;
  assert.match(loc.prompt, /Muindi Mbingu/i);
  assert.doesNotMatch(loc.prompt, /Shop No/i);
});

check("Library labels: renew uses real name not say-as", () => {
  const stored = lexiconForStorage([
    { match: "aisha", say: "Eye-sha", label: "Aisha", priority: 200 },
  ]);
  const parsed = parseTtsLexicon(stored);
  assert.equal(parsed[0].label, "Aisha");
  assert.equal(displayLexiconLabel(parsed[0]), "Aisha");
  const renew = customTrainingLine({
    phrase: displayLexiconLabel(parsed[0]),
    idPrefix: "renew",
  });
  assert.ok(renew);
  assert.match(renew!.prompt, /Aisha/);
  assert.doesNotMatch(renew!.prompt, /Eye-sha/);
});

check("Library edit say + pollution block", () => {
  assert.equal(isBlockedMatch("city"), true);
  assert.equal(isBlockedMatch("where"), true);
  assert.equal(isBlockedMatch(matchPatternFromPhrase("Muindi Mbingu")), false);
  const say = sanitizeSayForm("Moo-in-dee Mbeen-goo");
  assert.ok(say.includes("Moo") || say.includes("moo") || say.length > 3);
});

check("Fix: custom queue + typed save path", () => {
  const line = customTrainingLine({
    phrase: "White Paper Books",
    idPrefix: "custom",
  });
  assert.ok(line);
  assert.equal(customTrainingLine({ phrase: "city" }), null);
  let lexicon = parseTtsLexicon([]);
  lexicon = mergeLexiconEntry(lexicon, {
    match: matchPatternFromPhrase("White Paper Books"),
    say: "White Paper Books",
    label: "White Paper Books",
    priority: 200,
  });
  assert.ok(isPronunciationCovered(line!, lexicon));
});

check("Fix: mine calls with lowercase ASR + profile hints", () => {
  const hints = collectKnownPronunciationHints(chapterOne);
  assert.ok(hints.some((h) => /aisha/i.test(h)));
  const mined = mineSuggestionsFromAgentLines({
    lines: [
      "hello you've reached chapterone bookstore this is aisha speaking",
      "we are on muindi mbingu street opposite city market fashion mall",
    ],
    existingLexicon: [],
    knownHints: hints,
    limit: 8,
  });
  assert.ok(mined.length >= 1, "expected mined suggestions");
  assert.ok(
    mined.some((s) => /aisha|chapterone|muindi/i.test(s.targets[0].label))
  );
});

check("Phone preview applies trained say forms", () => {
  const lexicon = parseTtsLexicon([
    {
      match: "chapter\\s*one\\s+bookstore|chapterone\\s+bookstore",
      say: "Chapter One Bookstore",
      label: "ChapterOne Bookstore",
      priority: 220,
    },
    { match: "aisha", say: "Eye-sha", label: "Aisha", priority: 220 },
  ]);
  const preview = previewSpokenLine(
    "Hello, you've reached ChapterOne Bookstore, this is Aisha speaking.",
    lexicon
  );
  assert.match(preview, /Chapter One Bookstore/);
  assert.match(preview, /Eye-sha/);
  assert.doesNotMatch(preview, /Si-ti|loh-kay-tid/i);
});

check("Covered packs drop out of Practice queue", () => {
  const full = buildPronunciationPacks({ ...chapterOne, existingLexicon: [] });
  const trained = full.flatMap((p) =>
    p.targets.map((t) => ({
      match: t.match,
      say: t.label,
      label: t.label,
      priority: 200,
    }))
  );
  const remaining = buildPronunciationPacks({
    ...chapterOne,
    existingLexicon: parseTtsLexicon(trained),
  });
  assert.equal(remaining.length, 0);
});

console.log("");
if (failures.length) {
  console.error(`${failures.length} verification failure(s)`);
  process.exit(1);
}
console.log("All Pronunciation studio verification checks passed.");
