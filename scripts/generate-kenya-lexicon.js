#!/usr/bin/env node
// Build-time Kenyan phonetic candidates. Default: write
// src/speech/generatedKenyaLexicon.json only.
// Does not touch pronunciationLexicon.js unless --promote is passed.
// Not imported by the live call path.
//   node scripts/generate-kenya-lexicon.js
//   node scripts/generate-kenya-lexicon.js --promote

const fs = require('fs');
const path = require('path');

const { phoneticRespellDetails } = require('../src/speech/phoneticEngine');
const { isBlockedMatch } = require('../src/speech/pronunciationLexicon');
const { allWords } = require('./data/kenyanWordlists');

const LEXICON_PATH = path.join(__dirname, '../src/speech/pronunciationLexicon.js');
const GENERATED_JSON_PATH = path.join(
  __dirname,
  '../src/speech/generatedKenyaLexicon.json'
);
const BEGIN = '// GENERATED_KENYA_LEXICON_BEGIN';
const END = '// GENERATED_KENYA_LEXICON_END';
const GENERATED_PRIORITY = 80;
const ALLCAPS_RUN = /[A-Z]{2,}/;

function parseArgs(argv) {
  return { promote: argv.includes('--promote') };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toMatchPattern(word) {
  const cleaned = String(word || '')
    .trim()
    .toLowerCase()
    .replace(/['\u2018\u2019\u02bc]/g, "'");
  const slashParts = cleaned.split('/').map((p) => p.trim()).filter(Boolean);
  return slashParts
    .map((chunk) =>
      chunk
        .split(/\s+/)
        .filter(Boolean)
        .map((token) =>
          token
            .split('-')
            .filter(Boolean)
            .map(escapeRegex)
            .join('[\\s\\-]+')
        )
        .join('\\s+')
    )
    .join('\\s+');
}

function matchKeysFromPattern(match) {
  return String(match || '')
    .split('|')
    .map((part) =>
      part
        .replace(/\\s\+/gi, ' ')
        .replace(/\\[sS]\+/g, ' ')
        .replace(/\\[bB]/g, '')
        .replace(/\[\\s\\-\]\+/g, ' ')
        .replace(/[^a-zA-Z'\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

function handTunedRegion(source) {
  const arrayStart = source.indexOf('const KENYA_LEXICON = [');
  if (arrayStart < 0) throw new Error('Could not find KENYA_LEXICON array');
  const bodyStart = source.indexOf('[', arrayStart);
  const beginAt = source.indexOf(BEGIN);
  const bodyEnd = beginAt >= 0 ? beginAt : source.indexOf('\n];', bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

function collectProtectedKeysFromSource(source) {
  const keys = new Set();
  const re = /match:\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  const region = handTunedRegion(source);
  let m;
  while ((m = re.exec(region))) {
    const raw = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    for (const key of matchKeysFromPattern(raw)) keys.add(key);
  }
  return keys;
}

function expandSourceWords(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) continue;
    const pieces = [trimmed];
    for (const part of trimmed.split(/[\s/]+/)) {
      const bit = part.replace(/^mt\./i, '').trim();
      if (bit) pieces.push(bit);
    }
    for (const piece of pieces) {
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(piece);
    }
  }
  return out;
}

function formatJsEntry(entry) {
  const langs = JSON.stringify(entry.langs || ['en', 'sw', 'sheng']);
  return `  { match: ${JSON.stringify(entry.match)}, say: ${JSON.stringify(entry.say)}, langs: ${langs}, priority: ${entry.priority} },`;
}

function assertNoAllcaps(entries) {
  const bad = entries.filter((e) => ALLCAPS_RUN.test(String(e.say || '')));
  if (!bad.length) return;
  for (const e of bad) {
    console.error(`ALLCAPS in say: match=${e.match} say=${JSON.stringify(e.say)}`);
  }
  throw new Error(
    `${bad.length} generated say form(s) contain an ALLCAPS run of 2+ letters`
  );
}

function buildGenerated() {
  const source = fs.readFileSync(LEXICON_PATH, 'utf8');
  const protectedKeys = collectProtectedKeysFromSource(source);

  const generated = [];
  let skippedEnglish = 0;
  let skippedExisting = 0;
  let skippedBlocked = 0;
  const seenMatch = new Set();
  const wordInitialAi = [];

  for (const word of expandSourceWords(allWords())) {
    const detail = phoneticRespellDetails(word, { skipEnglish: true });
    if (!detail) {
      skippedEnglish += 1;
      const quiet = /^(north|south|east|west|central|town|hills|river|rural)$/i.test(
        String(word).trim()
      );
      if (!quiet) console.log(`skip english: ${word}`);
      continue;
    }
    const match = toMatchPattern(word);
    if (!match) continue;
    if (isBlockedMatch(match)) {
      skippedBlocked += 1;
      continue;
    }
    const keys = matchKeysFromPattern(match);
    if (keys.some((key) => protectedKeys.has(key))) {
      skippedExisting += 1;
      continue;
    }
    if (seenMatch.has(match)) continue;
    seenMatch.add(match);
    if (/^a[iu]/i.test(String(word).trim().replace(/['\u2018\u2019]/g, ''))) {
      wordInitialAi.push({ word, say: detail.say });
    }
    generated.push({
      match,
      say: detail.say,
      priority: GENERATED_PRIORITY,
      source: 'generated',
      stressSyllable: detail.stressSyllable,
      langs: ['en', 'sw', 'sheng'],
    });
  }

  generated.sort((a, b) => a.match.localeCompare(b.match));
  assertNoAllcaps(generated);
  return {
    generated,
    skippedEnglish,
    skippedExisting,
    skippedBlocked,
    wordInitialAi,
  };
}

function writeGeneratedJson(generated) {
  const payload = generated.map((e) => ({
    match: e.match,
    say: e.say,
    priority: e.priority,
    source: e.source,
    stressSyllable: e.stressSyllable,
  }));
  fs.writeFileSync(GENERATED_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

function promoteIntoLexicon(generated) {
  const source = fs.readFileSync(LEXICON_PATH, 'utf8');
  const beginAt = source.indexOf(BEGIN);
  const block = [
    `  ${BEGIN}`,
    '  // Produced by scripts/generate-kenya-lexicon.js --promote. Do not hand-edit.',
    ...generated.map(formatJsEntry),
    `  ${END}`,
  ].join('\n');

  let next;
  const endAt = source.indexOf(END);
  if (beginAt >= 0 && endAt > beginAt) {
    const from = source.lastIndexOf('\n', beginAt);
    const to = source.indexOf('\n', endAt);
    next = `${source.slice(0, from + 1)}${block}${source.slice(to)}`;
  } else {
    const arrayClose = source.indexOf(
      '\n];',
      source.indexOf('const KENYA_LEXICON = [')
    );
    if (arrayClose < 0) throw new Error('Could not find KENYA_LEXICON closing');
    next = `${source.slice(0, arrayClose)}\n\n${block}${source.slice(arrayClose)}`;
  }
  fs.writeFileSync(LEXICON_PATH, next);
}

function main() {
  const { promote } = parseArgs(process.argv);
  const {
    generated,
    skippedEnglish,
    skippedExisting,
    skippedBlocked,
    wordInitialAi,
  } = buildGenerated();

  writeGeneratedJson(generated);
  if (promote) {
    promoteIntoLexicon(generated);
    console.log('promoted into src/speech/pronunciationLexicon.js');
  } else {
    console.log('did not touch src/speech/pronunciationLexicon.js (pass --promote to merge)');
  }

  console.log(
    `generated=${generated.length} skippedEnglish=${skippedEnglish} skippedExisting=${skippedExisting} skippedBlocked=${skippedBlocked}`
  );
  console.log(`wrote ${path.relative(process.cwd(), GENERATED_JSON_PATH)}`);
  if (wordInitialAi.length) {
    console.log(`word-initial ai/au (${wordInitialAi.length}):`);
    for (const row of wordInitialAi) {
      console.log(`  ${row.word} -> ${row.say}`);
    }
  }
}

main();
