#!/usr/bin/env node
// Build-time merge of phoneticRespell() candidates into KENYA_LEXICON.
// Not imported by the live call path. Run: node scripts/generate-kenya-lexicon.js

const fs = require('fs');
const path = require('path');

const { phoneticRespell } = require('../src/speech/phoneticEngine');
const { isBlockedMatch } = require('../src/speech/pronunciationLexicon');
const { allWords } = require('./data/kenyanWordlists');

const LEXICON_PATH = path.join(__dirname, '../src/speech/pronunciationLexicon.js');
const BEGIN = '// GENERATED_KENYA_LEXICON_BEGIN';
const END = '// GENERATED_KENYA_LEXICON_END';
const GENERATED_PRIORITY = 80;

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

function countMatchLines(region) {
  return (region.match(/\{\s*match:/g) || []).length;
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

function formatEntry(entry) {
  const langs = JSON.stringify(entry.langs || ['en', 'sw', 'sheng']);
  return `  { match: ${JSON.stringify(entry.match)}, say: ${JSON.stringify(entry.say)}, langs: ${langs}, priority: ${entry.priority} },`;
}

function main() {
  const source = fs.readFileSync(LEXICON_PATH, 'utf8');
  const beginAt = source.indexOf(BEGIN);
  const protectedKeys = collectProtectedKeysFromSource(source);
  const handTunedCount = countMatchLines(handTunedRegion(source));
  const beforeCount = countMatchLines(source);

  const generated = [];
  let skippedEnglish = 0;
  let skippedExisting = 0;
  let skippedBlocked = 0;
  const seenMatch = new Set();

  for (const word of expandSourceWords(allWords())) {
    const say = phoneticRespell(word, { skipEnglish: true });
    if (!say) {
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
    generated.push({
      match,
      say,
      langs: ['en', 'sw', 'sheng'],
      priority: GENERATED_PRIORITY,
    });
  }

  generated.sort((a, b) => a.match.localeCompare(b.match));

  const block = [
    `  ${BEGIN}`,
    '  // Produced by scripts/generate-kenya-lexicon.js. Do not hand-edit.',
    ...generated.map(formatEntry),
    `  ${END}`,
  ].join('\n');

  let next;
  const endAt = source.indexOf(END);
  if (beginAt >= 0 && endAt > beginAt) {
    const from = source.lastIndexOf('\n', beginAt);
    const to = source.indexOf('\n', endAt);
    next = `${source.slice(0, from + 1)}${block}${source.slice(to)}`;
  } else {
    const arrayClose = source.indexOf('\n];', source.indexOf('const KENYA_LEXICON = ['));
    if (arrayClose < 0) throw new Error('Could not find KENYA_LEXICON closing');
    next = `${source.slice(0, arrayClose)}\n\n${block}${source.slice(arrayClose)}`;
  }

  fs.writeFileSync(LEXICON_PATH, next);

  const added = generated.length;
  const afterCount = handTunedCount + added;
  console.log(
    `lexicon: before=${beforeCount} added=${added} skippedEnglish=${skippedEnglish} skippedExisting=${skippedExisting} skippedBlocked=${skippedBlocked} after=${afterCount}`
  );
  console.log(`hand-tuned kept=${handTunedCount}; generated=${added}`);
}

main();
