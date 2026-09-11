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

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Split speakable text into completed sentences; keep the remainder.
 * Default is sentence-only. Word/comma early flush is opt-in (hurts articulation).
 * @param {string} text
 * @param {{ final?: boolean, earlyFlushChars?: number, earlyFlushWords?: number }} [opts]
 * @returns {{ chunks: string[], rest: string }}
 */
function splitSpeakableChunks(text, opts = {}) {
  const final = Boolean(opts.final);
  const earlyFlushChars = Number(
    opts.earlyFlushChars != null
      ? opts.earlyFlushChars
      : envInt('VOICE_STREAM_EARLY_CHARS', 0)
  );
  const earlyFlushWords = Number(
    opts.earlyFlushWords != null
      ? opts.earlyFlushWords
      : envInt('VOICE_STREAM_EARLY_WORDS', 0)
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

  function isTinyLeadIn(text) {
    const t = String(text || '')
      .replace(/[.!]+$/g, '')
      .trim()
      .toLowerCase();
    return /^(sure|great|okay|ok|alright|thanks|thank you|i'?m listening|mm-hmm|mm|sawa|poa|got it)$/.test(
      t
    );
  }

  // "Sure." / "Great." / "I'm listening." must not be their own Soniox utterance.
  while (chunks.length >= 2 && isTinyLeadIn(chunks[0])) {
    const tiny = chunks.shift();
    chunks[0] = `${tiny} ${chunks[0]}`.replace(/\s+/g, ' ').trim();
  }
  if (!final && chunks.length && isTinyLeadIn(chunks[chunks.length - 1])) {
    const tiny = chunks.pop();
    rest = `${tiny} ${rest}`.replace(/\s+/g, ' ').trim();
  }

  // Opt-in first-audio boost: flush a clause on comma before the period arrives.
  // Off by default. Flushing mid-phrase makes Soniox articulate a fragment, then restart.
  if (!final && earlyFlushChars > 0 && rest.length >= earlyFlushChars) {
    const comma = rest.lastIndexOf(',');
    // Require a real clause before the comma (avoid "Ok," alone) and some tail.
    if (comma >= 4 && rest.length - comma >= 8) {
      const head = rest.slice(0, comma + 1).trim();
      const tail = rest.slice(comma + 1).trim();
      if (head) chunks.push(head);
      rest = tail;
    }
  }

  // Opt-in word window. Speaks "We can send someone this" as if it were the end.
  if (!final && earlyFlushChars > 0 && earlyFlushWords > 0 && !chunks.length && rest) {
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
 * Model sentences that claim a booking/save before backend validation.
 * Those must never reach TTS. formatToolConfirmation speaks the outcome.
 */
function isOutcomeClaim(text) {
  const value = String(text || '');
  return /\b(let me (book|save|send|confirm|move)|i('ve| have) (booked|saved|sent|confirmed|moved|cancelled|canceled)|you('re| are) (booked|all set)|booking (attempt|confirmed|saved)|set up that booking|book that for you|i can (still take a visit|set up)|see you (on )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)|that (time|slot|day) (works|is (fine|good|booked|set))|(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today) at .{0,24}(is fine|works|is good|is booked)|nimeweka|nimekuwekea|nimehifadhi ziara)\b/i.test(
    value
  );
}

function hasCompleteToolBlock(raw) {
  return /###TOOL###[\s\S]*?###ENDTOOL###/i.test(String(raw || ''));
}

/**
 * Incremental spoken-chunk extractor for an LLM stream.
 */
function findPendingText(speakable, emittedSpoken) {
  if (!emittedSpoken) return speakable.trim();
  if (speakable.startsWith(emittedSpoken)) {
    return speakable.slice(emittedSpoken.length).trim();
  }
  // Robust prefix alignment: normalize whitespace/punctuation for matching
  // so mid-stream token merges or formatting shifts never reset emitted audio.
  const normChar = (c) => c.toLowerCase().replace(/[^a-z0-9]/g, '');
  let eIdx = 0;
  let sIdx = 0;
  while (sIdx < speakable.length && eIdx < emittedSpoken.length) {
    const sC = normChar(speakable[sIdx]);
    const eC = normChar(emittedSpoken[eIdx]);
    if (!sC) { sIdx += 1; continue; }
    if (!eC) { eIdx += 1; continue; }
    if (sC === eC) {
      sIdx += 1;
      eIdx += 1;
    } else {
      break;
    }
  }
  const strippedEmittedLen = emittedSpoken.replace(/[^a-zA-Z0-9]/g, '').length;
  if (!strippedEmittedLen || eIdx >= strippedEmittedLen * 0.9) {
    return speakable.slice(sIdx).trim();
  }
  return '';
}

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

    // Backend confirmation speaks the tool outcome. Do not flush leftover
    // model prose after a complete tool block (accept-then-object on live calls).
    if (hasCompleteToolBlock(raw)) {
      const pending = findPendingText(speakable, emittedSpoken);
      if (pending) {
        emittedSpoken = `${emittedSpoken} ${pending}`.replace(/\s+/g, ' ').trim();
      }
      return [];
    }

    // Only consider text beyond what we already flushed.
    // Never reset emittedSpoken to avoid duplicate speech playback.
    const pending = findPendingText(speakable, emittedSpoken);
    if (!pending) return [];

    const { chunks, rest } = splitSpeakableChunks(
      pending,
      { final, earlyFlushChars, earlyFlushWords }
    );

    const out = [];
    for (const c of chunks) {
      const clean = c.trim();
      if (!clean) continue;
      emittedSpoken = `${emittedSpoken} ${clean}`.replace(/\s+/g, ' ').trim();
      if (isOutcomeClaim(clean)) continue;
      out.push(clean);
    }

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
