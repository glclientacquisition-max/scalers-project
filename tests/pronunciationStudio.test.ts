/**
 * Pronunciation studio helpers — renew safety, labels, call mining.
 * Run: npx tsx --test tests/pronunciationStudio.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  displayLexiconLabel,
  humanLabelFromMatch,
  lexiconForStorage,
  parseTtsLexicon,
} from "../dashboard/src/lib/pronunciationLexicon.ts";
import {
  collectKnownPronunciationHints,
  customTrainingLine,
  mineSuggestionsFromAgentLines,
} from "../dashboard/src/lib/pronunciationMine.ts";

describe("lexicon labels for Renew/list", () => {
  it("humanLabelFromMatch recovers readable names from regex", () => {
    assert.equal(
      humanLabelFromMatch("muindi\\s+mbingu|miundi\\s+mbingu"),
      "Muindi Mbingu"
    );
    assert.equal(
      humanLabelFromMatch("chapter\\s*one\\s+bookstore|chapterone\\s+bookstore"),
      "Chapter One Bookstore"
    );
  });

  it("displayLexiconLabel never falls back to phonetic say", () => {
    const entry = {
      match: "aisha",
      say: "Eye-sha",
    };
    assert.equal(displayLexiconLabel(entry), "Aisha");
    assert.notEqual(displayLexiconLabel(entry), "Eye-sha");
  });

  it("lexiconForStorage keeps labels for desk renew", () => {
    const stored = lexiconForStorage([
      { match: "aisha", say: "Eye-sha", label: "Aisha", priority: 200 },
    ]);
    assert.equal(stored[0].label, "Aisha");
    const roundTrip = parseTtsLexicon(stored);
    assert.equal(roundTrip[0].label, "Aisha");
  });
});

describe("customTrainingLine / renew", () => {
  it("queues a renew line from the real name, not the say-as", () => {
    const line = customTrainingLine({
      phrase: "Aisha",
      idPrefix: "renew",
      reason: "Renew",
    });
    assert.ok(line);
    assert.match(line!.id, /^renew:/);
    assert.equal(line!.targets[0].label, "Aisha");
    assert.match(line!.prompt, /Aisha/);
    assert.doesNotMatch(line!.prompt, /Eye-sha/);
  });

  it("rejects common English words", () => {
    assert.equal(customTrainingLine({ phrase: "where" }), null);
    assert.equal(customTrainingLine({ phrase: "city" }), null);
  });
});

describe("call mining", () => {
  it("spots Title Case names in agent lines", () => {
    const suggestions = mineSuggestionsFromAgentLines({
      lines: [
        "We are on Muindi Mbingu Street opposite City Market Fashion Mall.",
        "You can ask for Harrison Maina.",
      ],
      existingLexicon: [],
      limit: 6,
    });
    const labels = suggestions.map((s) => s.targets[0].label).join(" | ");
    assert.match(labels, /Muindi|Harrison|City Market/i);
  });

  it("uses profile hints for lowercase ASR transcripts", () => {
    const hints = collectKnownPronunciationHints({
      businessName: "ChapterOne Bookstore",
      agentName: "Aisha",
      team: [{ name: "Harrison Maina" }],
      locations: [
        {
          address: "Muindi Mbingu Street, Shop No. M4",
          landmark: "opposite City Market Fashion Mall",
        },
      ],
    });
    assert.ok(hints.some((h) => /muindi/i.test(h)));
    assert.ok(hints.some((h) => /aisha/i.test(h)));

    const suggestions = mineSuggestionsFromAgentLines({
      lines: [
        "hello you've reached chapterone bookstore this is aisha speaking",
        "we are on muindi mbingu street near the mall",
      ],
      existingLexicon: [],
      knownHints: hints,
      limit: 8,
    });
    assert.ok(
      suggestions.some((s) => /aisha|chapterone|muindi/i.test(s.targets[0].label)),
      `expected profile hits, got ${JSON.stringify(suggestions.map((s) => s.targets[0].label))}`
    );
  });

  it("skips names already covered in lexicon", () => {
    const suggestions = mineSuggestionsFromAgentLines({
      lines: ["This is Aisha from ChapterOne Bookstore."],
      existingLexicon: [
        { match: "aisha", say: "Eye-sha", label: "Aisha" },
      ],
      knownHints: ["Aisha", "ChapterOne Bookstore"],
      limit: 6,
    });
    assert.ok(!suggestions.some((s) => /^aisha$/i.test(s.targets[0].label)));
  });

  it("rejects weak filler singles that polluted earlier scans", () => {
    const suggestions = mineSuggestionsFromAgentLines({
      lines: [
        "Just a moment please.",
        "The money is ready.",
        "Habari, how can I help you today?",
        "Good morning and thank you for calling.",
        "We are on Muindi Mbingu Street.",
        "We are on Muindi Mbingu Street again.",
      ],
      existingLexicon: [],
      knownHints: ["Muindi Mbingu Street"],
      limit: 8,
    });
    const labels = suggestions.map((s) => s.targets[0].label.toLowerCase());
    assert.ok(
      !labels.some((l) =>
        /^(just|money|habari|good|morning|thank|please|moment)$/.test(l)
      ),
      `unexpected weak labels: ${labels.join(", ")}`
    );
    assert.ok(
      labels.some((l) => /muindi/.test(l)),
      `expected Muindi hit, got ${labels.join(", ")}`
    );
  });

  it("does not mine one-off weak Title Case English words", () => {
    const suggestions = mineSuggestionsFromAgentLines({
      lines: ["Please Hold While I Check That For You."],
      existingLexicon: [],
      knownHints: [],
      limit: 6,
    });
    assert.equal(
      suggestions.length,
      0,
      `expected empty mine, got ${JSON.stringify(suggestions.map((s) => s.targets[0].label))}`
    );
  });
});
