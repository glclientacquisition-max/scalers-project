#!/usr/bin/env node
// Smoke: ChapterOne greeting / location lines through prepareForTts (+ optional tenant lexicon).
// Usage: node scripts/smoke-pronunciation-chapterone.js

const { prepareForTts } = require('../src/speech/ttsNormalize');
const { parseLexiconOverrides } = require('../src/speech/pronunciationLexicon');

const curated = parseLexiconOverrides([
  {
    match: 'chapter\\s*one\\s+bookstore|chapterone\\s+bookstore',
    say: 'Chapter One Bookstore',
    priority: 220,
  },
  { match: 'chapter\\s*one|chapterone', say: 'Chapter One', priority: 215 },
  { match: 'aisha', say: 'Eye-sha', priority: 220 },
  {
    match: 'muindi\\s+mbingu|miundi\\s+mbingu',
    say: 'Moo-in-dee Mbeen-goo',
    priority: 220,
  },
  {
    match: 'city\\s+market\\s+fashion\\s+mall',
    say: 'City Market Fashion Mall',
    priority: 210,
  },
]);

const lines = [
  "Hello, you've reached ChapterOne Bookstore, this is Aisha speaking.",
  'We are located on Muindi Mbingu Street, opposite City Market Fashion Mall, Shop No. M4.',
  'How can I help you today?',
  'Where are you located?',
];

let failed = 0;
for (const line of lines) {
  const out = prepareForTts(line, {
    callLanguage: 'en',
    extraLexicon: curated,
  }).text;
  const bad =
    /loh-kay-tid|Si-ti|ma-ket|fash-on|maw-l|Op-po-sit|Pay-per|Cus-to-mers/i.test(
      out
    );
  const okAisha = !/Aisha/i.test(line) || /Eye-sha|Aisha/i.test(out);
  const okChapter =
    !/ChapterOne|Chapter\s*One/i.test(line) || /Chapter One/i.test(out);
  console.log(bad || !okAisha || !okChapter ? 'FAIL' : 'OK  ', 'IN :', line);
  console.log('     OUT:', out);
  if (bad || !okAisha || !okChapter) failed += 1;
}

// Prove blocked pollution cannot re-enter via parse
const blocked = parseLexiconOverrides([
  { match: 'city', say: 'Si-ti', priority: 200 },
  { match: 'located', say: 'loh-kay-tid', priority: 200 },
  { match: 'aisha', say: 'Eye-sha', priority: 220 },
]);
if (blocked.length !== 1 || blocked[0].match !== 'aisha') {
  console.error('FAIL blocked-match filter', blocked);
  failed += 1;
} else {
  console.log('OK   blocked common-word matches filtered');
}

process.exit(failed ? 1 : 0);
