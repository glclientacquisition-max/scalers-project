// Buffer Gemini streamed text → flushable spoken chunks for Soniox TTS.
// Holds back tool markers (###TOOL### / ###ENDCALL###) so they are never spoken.

/**
 * Strip complete tool blocks and end-call markers for speech.
 * When final=false, also truncates incomplete marker prefixes.
 * @param {string} raw
 * @param {{ final?: boolean }} [opts]
 */
function stripMarkersForSpeech(raw, opts = {}) {
  const final = Boolean(opts.final);
  let s = String(raw || '');

  // Drop completed tool payloads.
  s = s.replace(/###TOOL###[\s\S]*?###ENDTOOL###/gi, '');

  if (final) {
    s = s.replace(/###ENDCALL###/gi, '');
    // Incomplete tool block at end — drop from marker onward.
    s = s.replace(/###TOOL###[\s\S]*$/i, '');
    s = s.replace(/###ENDTOOL###/gi, '');
  } else {
    // Hold anything from an incomplete marker onward.
    const toolStart = s.search(/###\s*TOOL###/i);
    const endStart = s.search(/###\s*END/i);
    const hashStart = s.search(/###\s*$/);
    let cut = s.length;
    for (const idx of [toolStart, endStart, hashStart]) {
      if (idx >= 0 && idx < cut) cut = idx;
    }
    s = s.slice(0, cut);
  }

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Split speakable text into completed sentences; keep the remainder.
 * Prefers early first-audio: short clauses / word windows before a full sentence.
 * @param {string} text
 * @param {{ final?: boolean, earlyFlushChars?: number, earlyFlushWords?: number }} [opts]
 * @returns {{ chunks: string[], rest: string }}
 */
function splitSpeakableChunks(text, opts = {}) {
  const final = Boolean(opts.final);
  const earlyFlushChars = Number(
    opts.earlyFlushChars != null
      ? opts.earlyFlushChars
      : process.env.VOICE_STREAM_EARLY_CHARS || 18
  );
  const earlyFlushWords = Number(
    opts.earlyFlushWords != null
      ? opts.earlyFlushWords
      : process.env.VOICE_STREAM_EARLY_WORDS || 5
  );
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return { chunks: [], rest: '' };

  /** @type {string[]} */
  const chunks = [];
  const re = /(.+?[.!?])(?:\s+|$)/g;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const piece = m[1].trim();
    if (piece) chunks.push(piece);
    lastIndex = re.lastIndex;
  }
  let rest = src.slice(lastIndex).trim();

  // First-audio boost: flush a clause on comma before the period arrives.
  if (!final && rest.length >= earlyFlushChars) {
    const comma = rest.lastIndexOf(',');
    // Require a real clause before the comma (avoid "Ok," alone) and some tail.
    if (comma >= 4 && rest.length - comma >= 8) {
      const head = rest.slice(0, comma + 1).trim();
      const tail = rest.slice(comma + 1).trim();
      if (head) chunks.push(head);
      rest = tail;
    }
  }

  // Second boost: if still no sentence/comma flush, speak the first N words once
  // we have a stable clause-sized window (keeps first audio under ~1s).
  if (!final && !chunks.length && rest) {
    const words = rest.split(/\s+/).filter(Boolean);
    if (words.length >= earlyFlushWords && rest.length >= earlyFlushChars) {
      const head = words.slice(0, earlyFlushWords).join(' ');
      const tail = words.slice(earlyFlushWords).join(' ');
      // Avoid flushing mid-toolish fragments or tiny acknowledgements alone.
      if (head.length >= 10 && !/[,:;]$/.test(head)) {
        chunks.push(head);
        rest = tail;
      }
    }
  }

  if (final && rest) {
    chunks.push(rest);
    rest = '';
  }

  return { chunks, rest };
}

/**
 * Incremental spoken-chunk extractor for an LLM stream.
 */
function createSpokenStreamBuffer(opts = {}) {
  let raw = '';
  let emittedSpoken = '';
  const earlyFlushChars = opts.earlyFlushChars;
  const earlyFlushWords = opts.earlyFlushWords;

  /**
   * @param {string} delta
   * @param {{ final?: boolean }} [pushOpts]
   * @returns {string[]} newly flushable spoken chunks
   */
  function push(delta, pushOpts = {}) {
    if (delta) raw += delta;
    const final = Boolean(pushOpts.final);
    const speakable = stripMarkersForSpeech(raw, { final });

    // Only consider text beyond what we already flushed (prefix-stable after strip).
    let pending;
    if (speakable.startsWith(emittedSpoken)) {
      pending = speakable.slice(emittedSpoken.length).trim();
    } else {
      // Marker stripping shrank earlier text — recompute against full speakable.
      pending = speakable.trim();
      emittedSpoken = '';
    }

    const { chunks, rest } = splitSpeakableChunks(
      emittedSpoken ? `${pending}` : speakable,
      { final, earlyFlushChars, earlyFlushWords }
    );

    // When emittedSpoken is set, splitSpeakableChunks already got only pending.
    const out = [];
    for (const c of chunks) {
      const clean = c.trim();
      if (!clean) continue;
      out.push(clean);
      emittedSpoken = `${emittedSpoken} ${clean}`.replace(/\s+/g, ' ').trim();
    }

    // Keep rest un-emitted (already not in emittedSpoken).
    void rest;
    return out;
  }

  function finish() {
    return push('', { final: true });
  }

  function getRaw() {
    return raw;
  }

  function getSpokenEmitted() {
    return emittedSpoken.trim();
  }

  return {
    push,
    finish,
    getRaw,
    getSpokenEmitted,
    stripMarkersForSpeech,
  };
}

module.exports = {
  stripMarkersForSpeech,
  splitSpeakableChunks,
  createSpokenStreamBuffer,
};
