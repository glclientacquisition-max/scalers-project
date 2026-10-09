'use strict';

// The open-file read-out the caller hears after confirming their name.
//
// HD_ceba9d9b3f37 (staging 2026-10-09): "Yes, it's me." got two visits and
// three requests in one breath, then nothing. The caller said "Okay." and
// waited in silence. A read-out is short and hands the turn back:
//   - at most READ_OUT_MAX_ITEMS rows are read (visits first, as Brain
//     ordered them), the rest are one more_open count;
//   - it ends on a short question (en / sw / sheng), unless it already does.
// Brain (planConfirmFileRead / openFileRead) still decides what is open and
// in what order; Voice decides how much of it is said.

const { factLine, renderLines } = require('../conversation/factLine');
const { requestItemPhrase } = require('./spokenFacts');

const READ_OUT_MAX_ITEMS = 2;

// One question, also when rows were left out: no code path reads "the
// others" on a bare yes, so the agent does not offer it. The more_open count
// already tells them more is on file; they can ask about it.
const QUESTIONS = {
  en: 'Would you like to change any of these, or is it something else?',
  sw: 'Ungependa kubadilisha yoyote kati ya hizi, au ni jambo lingine?',
  sheng: 'Unataka kubadilisha yoyote, ama ni kitu ingine?',
};

function langOf(lang) {
  const value = String(lang || 'en').toLowerCase();
  if (value === 'sheng') return 'sheng';
  if (value === 'sw' || value.startsWith('swahili')) return 'sw';
  return 'en';
}

/** The question that closes a read-out. */
function readOutQuestion(language) {
  return QUESTIONS[langOf(language)];
}

/** Append the closing question unless the text already ends on one. */
function withReadOutQuestion(text, language) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  if (!line) return '';
  if (/\?\s*$/.test(line)) return line;
  return `${line} ${readOutQuestion(language)}`;
}

function cleanRequestLine(line) {
  if (!line || line.template !== 'request_open') return line;
  const item = requestItemPhrase(line.slots?.item);
  if (!item) return line;
  return { ...line, slots: { ...line.slots, item } };
}

/**
 * Cap a Brain open-file read ({ line, lines, kind }) to READ_OUT_MAX_ITEMS
 * rows plus one more_open count, and end it on the read-out question.
 * @param {{ line: string, lines: Array<object>, kind?: string }|null} read
 * @param {{ language?: string, now?: Date, maxItems?: number }} [opts]
 * @returns {null|{ line: string, lines: Array<object>, kind?: string, kept: number, more: number, question: string }}
 */
function shapeFileReadOut(read, opts = {}) {
  if (!read || !Array.isArray(read.lines) || !read.lines.length) return read || null;
  const language = langOf(opts.language);
  const max = Number.isInteger(opts.maxItems) && opts.maxItems > 0 ? opts.maxItems : READ_OUT_MAX_ITEMS;
  const items = read.lines.filter((l) => l && l.template !== 'more_open');
  const moreLine = read.lines.find((l) => l && l.template === 'more_open');
  const moreBefore = Number(moreLine?.slots?.count) || 0;
  const openRows = Number(moreLine?.gate?.open_rows);
  const total = Number.isInteger(openRows) && openRows > 0 ? openRows : items.length + moreBefore;
  const kept = items.slice(0, max).map(cleanRequestLine);
  const more = Math.max(0, total - kept.length);
  const lines = kept.map((l) => {
    const { text, ...rest } = l;
    return rest;
  });
  if (more > 0) {
    lines.push(
      factLine('more_open', { count: more }, { lang: language, gate: { open_rows: total, spoken: kept.length } })
    );
  }
  const rendered = renderLines(lines, { now: opts.now || new Date() });
  if (!rendered.line) return read;
  const question = readOutQuestion(language);
  return {
    ...read,
    line: withReadOutQuestion(rendered.line, language),
    lines: rendered.lines,
    kept: kept.length,
    more,
    question,
  };
}

module.exports = {
  READ_OUT_MAX_ITEMS,
  readOutQuestion,
  withReadOutQuestion,
  shapeFileReadOut,
};
