// Drop Gemini control labels that leaked into speech on HD_ff24acf5207d.
// Caller must never hear ASR_CORRECTION_PROMPT, RETOTI, or NP_FALSE.

const KNOWN_LABEL =
  /\b(?:ASR_CORRECTION_PROMPT|RETOTI|CONTROL[_\s-]?VOICE|NEXT[_\s-]?BEST[_\s-]?ACTION)\s*:\s*/gi;
const SNAKE_LABEL = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\s*:\s*/g;
const NP_TOKEN = /\bNP_(?:TRUE|FALSE)\b/gi;
const META_CLAUSES = [
  /\bThe user's input seems truncated or quiet\.?\s*/gi,
  /\bAsk for missing details or to repeat gently\.?\s*/gi,
];
const INCOMPLETE_HOLD =
  /\b(?:ASR_?[A-Z_]*|RETO(?:TI?)?|NP_?(?:TRUE|FALSE|T|F)?|CONTROL[_\s-]?VOICE|NEXT[_\s-]?BEST[_\s-]?ACTION)\s*$/i;

function resetGlobal(re) {
  re.lastIndex = 0;
  return re;
}

/**
 * Strip instruction / control labels from model text before TTS or history.
 * When final=false, hold an incomplete label suffix so it is not spoken mid-token.
 * @param {string} raw
 * @param {{ final?: boolean }} [opts]
 */
function stripSpokenInstructionLeaks(raw, opts = {}) {
  const final = Boolean(opts.final);
  let s = String(raw || '');
  if (!s) return '';

  s = s.replace(resetGlobal(NP_TOKEN), ' ');
  s = s.replace(resetGlobal(KNOWN_LABEL), ' ');
  s = s.replace(resetGlobal(SNAKE_LABEL), ' ');
  for (const re of META_CLAUSES) {
    s = s.replace(resetGlobal(re), ' ');
  }

  if (!final) {
    const hold = s.search(INCOMPLETE_HOLD);
    if (hold >= 0) s = s.slice(0, hold);
  } else {
    s = s.replace(INCOMPLETE_HOLD, ' ');
    s = s.replace(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\s*:?\s*$/g, ' ');
  }

  return s.replace(/\s+/g, ' ').trim();
}

module.exports = {
  stripSpokenInstructionLeaks,
};
