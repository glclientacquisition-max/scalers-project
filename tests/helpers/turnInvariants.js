'use strict';
const assert = require('node:assert');
const ML = require('../../src/conversation/v2/modelLead');

const YES = /\b(yes|we (?:do )?cover|we (?:can )?come|tunafika|ndio)\b/i;
const NO = /\b(don'?t|do not|not|can'?t confirm|hatufiki|hatuna hakika|sorry)\b/i;

/** Fail when one turn emits contradictory coverage/price claims or multiple content owners fighting. */
function assertTurnSpeech({ sentences = [], heard = '' } = {}) {
  const parts = sentences.length ? sentences : String(heard).split(/(?<=[.!?])\s+/).map((t) => ({ text: t, src: 'unknown' }));
  const content = parts.filter((p) => p.src && !['filler', 'unknown'].includes(p.src));
  const hasModel = content.some((p) => /^(model|repair_model|repair_template|step)$/.test(p.src));
  const hasOwed = content.some((p) => p.src === 'owed_answer');
  if (hasModel && hasOwed) {
    const modelText = content.filter((p) => /^(model|repair)/.test(p.src)).map((p) => p.text).join(' ');
    const owedText = content.filter((p) => p.src === 'owed_answer').map((p) => p.text).join(' ');
    if (ML.UNSURE.test(modelText) && YES.test(owedText)) {
      assert.fail(`contradicting coverage owners: model="${modelText}" owed="${owedText}"`);
    }
  }
  const text = parts.map((p) => p.text).join(' ');
  for (const place of ML.placesNamedInText(text)) {
    const chunks = parts.map((p) => p.text).filter((t) => ML.placesNamedInText(t).some((n) => n.toLowerCase() === place.toLowerCase()));
    const yes = chunks.some((c) => YES.test(c) && !NO.test(c));
    const no = chunks.some((c) => NO.test(c) && !/\?\s*$/.test(c));
    if (yes && no) assert.fail(`contradicting coverage for ${place}: ${chunks.join(' | ')}`);
  }
}

module.exports = { assertTurnSpeech };
