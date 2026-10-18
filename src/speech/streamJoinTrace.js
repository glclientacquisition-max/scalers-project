// Where does a missing space come from? Per-turn evidence for the model trace.
//
// HD_49d726c3dc9b (18 Oct) logged outputText "OnTuesday, we will be open..." and
// "Karubusana,Alvin!". Our joins only ever add a space (joinSpokenPieces), so a
// glue in outputText is either inside one Gemini delta (model side) or at a delta
// boundary where neither side carried the space. This records which, without
// changing any text. Read it on the model stage as `stream`.

const WORDISH_END = /[A-Za-z0-9,.!?;:]$/;
const WORDISH_START = /^[A-Za-z0-9]/;
const SAMPLE_LIMIT = 3;
const SAMPLE_CHARS = 12;

function createStreamJoinTrace() {
  let deltas = 0;
  let unspacedJoins = 0;
  let addedSpaces = 0;
  const samples = [];

  /**
   * @param {string} before fullText before this delta
   * @param {string} delta  raw delta text from the chunk
   * @param {string} after  fullText after joinSpokenPieces
   */
  function note(before, delta, after) {
    const a = String(before || '');
    const b = String(delta || '');
    if (!b) return;
    deltas += 1;
    if (!a) return;
    const joined = String(after || '');
    if (joined.length > a.length + b.length) {
      addedSpaces += 1;
      return;
    }
    if (WORDISH_END.test(a) && WORDISH_START.test(b)) {
      unspacedJoins += 1;
      if (samples.length < SAMPLE_LIMIT) {
        samples.push(`${a.slice(-SAMPLE_CHARS)}|${b.slice(0, SAMPLE_CHARS)}`);
      }
    }
  }

  function summary() {
    return { deltas, unspacedJoins, addedSpaces, unspacedSamples: samples.slice() };
  }

  return { note, summary };
}

module.exports = { createStreamJoinTrace };
