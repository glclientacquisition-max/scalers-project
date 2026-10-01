/**
 * Lightweight checks for pronunciation coach helpers.
 * Run: node --test tests/pronunciationCoach.test.js
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localAudioLikelyMatches(opts) {
  const heard = normalizeForCompare(opts.heard);
  if (!heard || heard.length < 2) return false;
  const prompt = normalizeForCompare(opts.prompt);
  if (!prompt) return false;
  const promptTokens = prompt.split(" ").filter((t) => t.length > 2);
  const heardSet = new Set(heard.split(" "));
  const overlap = promptTokens.filter((t) => heardSet.has(t)).length;
  if (promptTokens.length && overlap / promptTokens.length >= 0.45) {
    return true;
  }
  const targets = opts.targets || [];
  if (targets.length) {
    const heardCompact = heard.replace(/\s+/g, "");
    return targets.some((t) => {
      const label = normalizeForCompare(t.label).replace(/\s+/g, "");
      return label.length >= 3 && heardCompact.includes(label);
    });
  }
  return false;
}

describe("pronunciation recording guardrails", () => {
  it("accepts a close take of the asked line", () => {
    assert.equal(
      localAudioLikelyMatches({
        prompt: "Hi, this is Aisha from ChapterOne Bookstore",
        heard: "hi this is aisha from chapterone bookstore",
        targets: [
          { label: "Aisha", match: "aisha" },
          { label: "ChapterOne Bookstore", match: "chapterone" },
        ],
      }),
      true
    );
  });

  it("rejects a totally different utterance", () => {
    assert.equal(
      localAudioLikelyMatches({
        prompt: "Hi, this is Aisha from ChapterOne Bookstore",
        heard: "sugar water please",
        targets: [
          { label: "Aisha", match: "aisha" },
          { label: "ChapterOne Bookstore", match: "chapterone" },
        ],
      }),
      false
    );
  });
});

describe("pronunciation coach chrome", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "dashboard/src/components/PronunciationCoach.tsx"),
    "utf8"
  );

  it("titles the panel Pronunciation with accent-deep links", () => {
    assert.match(src, />\s*Pronunciation\s*</);
    assert.doesNotMatch(src, /Pronunciation Overrides/);
    assert.doesNotMatch(src, /Practice lines/);
    assert.doesNotMatch(src, /After you save overrides/);
    assert.doesNotMatch(src, /text-\[var\(--accent\)\]/);
    assert.match(src, /text-accent-deep/);
    assert.doesNotMatch(src, /say this line/);
  });

  it("lets Library and the saved take Hear the stored name on the preview route", () => {
    const file = path.join(__dirname, "..", "dashboard/src/lib/pronunciationLexicon.ts");
    const script = `
      import { pronunciationHearBody } from ${JSON.stringify(file)};
      const body = pronunciationHearBody({
        name: "Aisha",
        lexicon: [{ match: "aisha", say: "Eye-sha", label: "Aisha" }],
        voiceId: "Kenya-A",
      });
      const blank = pronunciationHearBody({
        name: "  Muindi Mbingu  ",
        lexicon: [],
        voiceId: "  ",
      });
      process.stdout.write(JSON.stringify({ body, blank }));
    `;
    const ran = spawnSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", script],
      { encoding: "utf8" }
    );
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const parsed = JSON.parse(ran.stdout);
    assert.equal(parsed.body.text, "Aisha");
    assert.equal(parsed.body.voiceId, "Kenya-A");
    assert.equal(parsed.body.lexicon[0].say, "Eye-sha");
    assert.equal(parsed.body.lexicon[0].match, "aisha");
    assert.equal(parsed.blank.text, "Muindi Mbingu");
    assert.equal(parsed.blank.voiceId, null);

    assert.match(src, /\/api\/pronunciation\/preview/);
    assert.match(src, /pronunciationHearBody/);
    assert.match(src, /objectUrlFromPreviewResponse/);
    assert.match(src, /assertPreviewAudioPlayable/);
    assert.match(src, /Callers hear this/);
    assert.match(src, /data-testid="pronunciation-hear"/);
    assert.match(src, /data-testid="caller-proof"/);
    assert.doesNotMatch(src, /Live on the next call/);
    assert.doesNotMatch(src, /Saved \$\{n\} pronunciation/);
    assert.doesNotMatch(src, /[—–]/);
    assert.doesNotMatch(src, /autoPlay/);

    const library = src.slice(src.indexOf('mode === "library"'), src.indexOf('mode === "fix"'));
    assert.match(library, /HearButton/);
    assert.match(library, /btnPrimary/);
    assert.match(library, /libraryMutedClass/);
    assert.match(library, /basis-full/);
    assert.match(library, /md:basis-auto/);
    assert.doesNotMatch(library, /w-full[^"]*Hear|Hear[^"]*w-full/);
    assert.match(library, /Renew/);
    assert.match(library, /Edit say/);
    assert.match(library, /Remove/);
    assert.match(library, /libraryLinkClass/);
    assert.match(library, /Hear it first/);
    assert.match(library, /\{entry\.say\}/);
    assert.doesNotMatch(library, /phone says/);
    assert.doesNotMatch(src, /Apply all high-confidence/);
    assert.doesNotMatch(src, /Auto-applied/);
    assert.doesNotMatch(src, /Approve spelling/);
    assert.doesNotMatch(src, /Phone says wrong/);
    assert.doesNotMatch(src, /Opening line/);
    assert.match(src, /Nothing waiting/);
    assert.doesNotMatch(src, /Nothing waiting\. Add a fix/);
    assert.doesNotMatch(src, /AI will listen/);
    assert.doesNotMatch(src, /Could not save pronunciation review/);
    assert.match(src, /Listen to the last \{geminiBatch\} recordings\./);
    assert.doesNotMatch(src, /This is paid/);
    assert.doesNotMatch(src, /paid API/);
    assert.doesNotMatch(src, /Gemini Scan/);
    assert.doesNotMatch(src, /GEMINI_API_KEY/);
    assert.doesNotMatch(src, /Ask support/);
    assert.doesNotMatch(src, /Callers hear your business name first/);
    const needsReview = src.slice(
      src.indexOf("{mode === \"fix\""),
      src.indexOf("{/* 3) Find more */}")
    );
    assert.match(needsReview, /Nothing waiting\./);
    assert.doesNotMatch(needsReview, /geminiState\.error/);
    assert.doesNotMatch(needsReview, /Could not save the listen/);
    const afterConfirm = src.slice(src.indexOf("geminiConfirmOpen ?"));
    assert.match(afterConfirm, /geminiState\.error/);
    const findStart = src.indexOf("{/* 3) Find more */}");
    const findMore = src.slice(findStart, src.indexOf("geminiConfirmOpen ?", findStart));
    assert.match(findMore, /AI listen/);
    assert.match(findMore, /btnPrimary/);
    const scanBtn = findMore.slice(
      findMore.lastIndexOf("onClick={scanCalls}"),
      findMore.indexOf("Scanning")
    );
    assert.match(scanBtn, /settingsGhostButtonClass/);
    assert.doesNotMatch(scanBtn, /btnPrimary/);

    const record = src.slice(
      src.indexOf("async function startRecording"),
      src.indexOf("async function startRecording") + 280
    );
    assert.match(record, /clearCallerHear\(\)/);
    assert.match(src, /keptTakeUrl/);
    assert.match(src, /data-testid="saved-take-audio"/);
    const confirmKeep = src.slice(
      src.indexOf("if (confirmState.ok && confirmState.lexicon)"),
      src.indexOf("if (!confirmState.ok || !confirmState.entries")
    );
    assert.doesNotMatch(confirmKeep, /revokeObjectURL\(prev\)/);
    assert.match(confirmKeep, /keptTakeUrlRef/);

    const form = fs.readFileSync(
      path.join(__dirname, "..", "dashboard/src/components/TenantForm.tsx"),
      "utf8"
    );
    assert.match(form, /voiceId=\{tenant\.soniox_voice_id/);
    assert.match(form, /lexicon: lexiconForStorage\(ttsLexicon\)/);
    assert.match(form, /Hear sample/);
  });
});
