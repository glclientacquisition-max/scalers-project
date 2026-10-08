// How one prepared text piece goes onto the Soniox TTS wire.
//
// Soniox joins the text pieces of one stream exactly as sent (its own wire
// example sends "Hello there," then " this is Soniox"). Every piece reaching
// pushText is already trimmed, so a second sentence in the same stream used to
// arrive glued to the first: HD_015bae4a4af2 sent "Yes we cover Kee-ten-geh-la"
// then "Interior window cleaning ..." then "What day and time ...", which
// Soniox read as "Kee-ten-geh-laInterior" and "windowWhat". The caller said
// "Pardon me?" and reported that it read punctuation.
//
// Rules, for every caller of pushText:
// - a piece with no letter or digit is never sent (a lone ",", "-", "...");
// - the second and later pieces of a stream open with one space, so a word
//   boundary always exists between pieces.
// Punctuation handling stays in prepareForTts; this module does not change it.

const SPOKEN_CHAR = /[\p{L}\p{N}]/u;

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasSpokenChar(text) {
  return SPOKEN_CHAR.test(String(text || ''));
}

/**
 * Text for one Soniox text message. Empty when nothing speakable is left.
 * @param {string} text prepared piece
 * @param {{ first?: boolean }} [opts] first: this is the stream's first piece
 * @returns {string}
 */
function wireTextForPiece(text, opts = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean || !hasSpokenChar(clean)) return '';
  return opts.first === false ? ` ${clean}` : clean;
}

module.exports = {
  hasSpokenChar,
  wireTextForPiece,
};
