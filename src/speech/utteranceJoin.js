// Caller finals into one utterance. Soniox marks a word boundary with a
// leading space on the next final (" kisu."). The server trims each final for
// its own checks, so joining the trimmed parts with '' glued words together:
// "cover" + "kisu." -> "coverkisu", "to me" + "the place." -> "methe place",
// "And" + "una." -> "Anduna." (HD_ee813bcf6248). A final with no leading space
// continues the previous word and is appended to it.

/**
 * Add one STT final to the utterance parts.
 * @param {string[]} parts  mutated
 * @param {string} rawFinal  the final as the STT sent it (untrimmed)
 * @returns {string[]}
 */
function appendFinalPart(parts, rawFinal) {
  const raw = String(rawFinal ?? '');
  const text = raw.trim();
  if (!text) return parts;
  const continuesWord = parts.length > 0 && !/^\s/.test(raw);
  if (continuesWord) parts[parts.length - 1] = `${parts[parts.length - 1]}${text}`;
  else parts.push(text);
  return parts;
}

/** One caller utterance from its parts, a single space between parts. */
function joinUtteranceParts(parts) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { appendFinalPart, joinUtteranceParts };
