'use strict';

// Pre-TTS spoken-facts guard (VOICE_SPOKEN_FACTS). Finds spoken times and
// KES amounts in a reply and checks them against this turn's stored facts
// (tool results and the caller file):
//   - a Kiswahili clock slip that names a stored time ("saa 9 asubuhi" for
//     09:00) is rewritten to the Kiswahili clock ("saa tatu asubuhi");
//   - a visit time that names no stored time is replaced with the latest
//     written time when one exists in this call, else reported;
//   - an amount that is not a stored price is reported (never rewritten).
// The structured path uses the same checks through verify (problems, then a
// code data line); this module is the classic path's guard at TTS prep.

const { swahiliClock, reconcileSwahiliTimes } = require('../../conversation/swahiliClock');
const { clockEn } = require('./index');

const VISIT_WORDS =
  /\b(?:ziara|visit|appointment|booking|miadi|nimehifadhi|nimehamisha|saved|moved|rescheduled|tufike|tutafika|we'?ll come)\b/i;
const EN_CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/gi;
const AMOUNT =
  /\b(?:KSh|Ksh|KES|Kshs|Sh)\.?\s*([\d,]+(?:\.\d{1,2})?)\b|\b([\d,]+(?:\.\d{1,2})?)\s*(?:shillings|bob|\/=)/gi;

function sentencesOf(text) {
  return String(text || '').split(/(?<=[.?!])\s+/);
}

function minutesOfEnClock(h, m, mer) {
  const hour = Number(h);
  if (!(hour >= 1 && hour <= 12)) return null;
  return ((hour % 12) + (/^p/i.test(mer) ? 12 : 0)) * 60 + Number(m || 0);
}

/**
 * @param {string} text reply text before TTS expansion
 * @param {{ lang?: string, times?: number[], latestTime?: number|null, amounts?: number[] }} facts
 *   times: stored visit times (minutes since midnight EAT); latestTime: the
 *   time written on this call, if any; amounts: stored prices in shillings.
 * @returns {{ text: string, mismatches: Array<{ kind: string, said: string, stored: number[] }>, replaced: Array<{ said: string, spoken: string }> }}
 */
function guardSpokenFacts(text, facts = {}) {
  const lang = String(facts.lang || 'en').toLowerCase();
  const times = [...new Set((facts.times || []).filter(Number.isFinite))];
  const latest = Number.isFinite(facts.latestTime) ? facts.latestTime : null;
  const amounts = new Set((facts.amounts || []).filter(Number.isFinite));
  const mismatches = [];
  const replaced = [];
  const out = sentencesOf(text).map((sentence) => {
    let line = sentence;
    const aboutVisit = VISIT_WORDS.test(line);
    if (lang === 'sw' && times.length) {
      const checked = reconcileSwahiliTimes(line, times);
      if (checked.text !== line) replaced.push({ said: line, spoken: checked.text });
      line = checked.text;
      for (const miss of checked.mismatches) {
        if (aboutVisit && latest != null) {
          const spoken = swahiliClock(latest);
          line = line.replace(miss.said, spoken);
          replaced.push({ said: miss.said, spoken });
        } else {
          mismatches.push({ kind: 'time', said: miss.said, stored: times });
        }
      }
    }
    if (times.length && aboutVisit) {
      line = line.replace(EN_CLOCK, (full, h, m, mer) => {
        const value = minutesOfEnClock(h, m, mer);
        if (value == null || times.includes(value)) return full;
        if (latest != null) {
          const spoken = clockEn(latest);
          replaced.push({ said: full, spoken });
          return spoken;
        }
        mismatches.push({ kind: 'time', said: full, stored: times });
        return full;
      });
    }
    if (amounts.size) {
      AMOUNT.lastIndex = 0;
      let match;
      while ((match = AMOUNT.exec(line))) {
        const value = Number(String(match[1] || match[2]).replace(/,/g, ''));
        if (Number.isFinite(value) && !amounts.has(value)) {
          mismatches.push({ kind: 'amount', said: match[0].trim(), stored: [...amounts] });
        }
      }
    }
    return line;
  });
  return { text: out.join(' '), mismatches, replaced };
}

module.exports = { guardSpokenFacts };
