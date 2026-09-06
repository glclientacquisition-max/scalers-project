// Generation-tagged overlap hold + last committed agent question for Sorry/Pardon replay.
// One hold buffer per media session. Idle STT assembly stays on utteranceParts.

const { agentAwaitingReply } = require('./turnTaking');

const CONFIRM_ANSWER_RE =
  /^(yes|yeah|yep|yup|no|nope|sawa|ndiyo|ndio|hapana)(?:\s+please)?$/i;

function normalizeAnswer(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/**
 * Caller finals heard while the agent is speaking, keyed to a playback generation.
 * Drain is exactly-once per generation.
 */
function createOverlapHold() {
  /** @type {{ id: number, text: string, generation: number }[]} */
  let held = [];
  let nextId = 1;
  /** @type {Set<number>} */
  const drained = new Set();
  /** @type {Map<number, string>} */
  const interims = new Map();

  /** @type {Set<string>} */
  const releasedTexts = new Set();

  function markReleased(text) {
    const clean = normalizeAnswer(text).toLowerCase();
    if (clean) releasedTexts.add(clean);
  }

  function alreadyReleased(text) {
    const clean = normalizeAnswer(text).toLowerCase();
    return Boolean(clean && releasedTexts.has(clean));
  }

  function enqueue(text, generation) {
    const clean = normalizeAnswer(text);
    const gen = Number(generation);
    if (!clean || !Number.isFinite(gen) || gen <= 0) return null;
    if (drained.has(gen)) return null;
    if (alreadyReleased(clean)) return null;

    const exact = held.find((item) => item.generation === gen && item.text === clean);
    if (exact) return exact;

    if (CONFIRM_ANSWER_RE.test(clean)) {
      const sibling = held.find(
        (item) => item.generation === gen && CONFIRM_ANSWER_RE.test(item.text)
      );
      if (sibling) {
        if (clean.length >= sibling.text.length) sibling.text = clean;
        return sibling;
      }
    }

    const item = { id: nextId++, text: clean, generation: gen };
    held.push(item);
    interims.delete(gen);
    return item;
  }

  function noteInterim(text, generation) {
    const clean = normalizeAnswer(text);
    const gen = Number(generation);
    if (!clean || !Number.isFinite(gen) || gen <= 0 || drained.has(gen)) return null;
    if (held.some((item) => item.generation === gen)) return null;
    interims.set(gen, clean);
    return clean;
  }

  function consumeInterimIfMatches(text) {
    const clean = normalizeAnswer(text).toLowerCase();
    if (!clean) return false;
    let matched = false;
    for (const [gen, interim] of interims) {
      const i = interim.toLowerCase();
      if (clean === i || clean.startsWith(i) || i.startsWith(clean)) {
        interims.delete(gen);
        matched = true;
      }
    }
    return matched;
  }

  function takeAllInterims() {
    const texts = [...interims.values()].filter((t) => !alreadyReleased(t));
    interims.clear();
    return texts.join(' ').replace(/\s+/g, ' ').trim();
  }

  function pendingFor(generation) {
    const gen = Number(generation);
    return held.filter((item) => item.generation === gen).map((item) => item.text);
  }

  function hasPending(generation) {
    const gen = Number(generation);
    if (held.some((item) => item.generation === gen)) return true;
    return interims.has(gen);
  }

  function pending() {
    return held.map((item) => ({ text: item.text, generation: item.generation }));
  }

  /**
   * Release caller finals held for this playback generation exactly once.
   * Interims are not promoted to Gemini here; endpoint/final completes them.
   */
  function drain(generation) {
    const gen = Number(generation);
    if (!Number.isFinite(gen) || gen <= 0) {
      return { text: '', items: [], duplicate: false };
    }
    if (drained.has(gen)) {
      return { text: '', items: [], duplicate: true };
    }
    drained.add(gen);
    const items = held.filter((item) => item.generation === gen);
    held = held.filter((item) => item.generation !== gen);
    if (items.length) interims.delete(gen);
    const text = items
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, items, duplicate: false };
  }

  function discardGeneration(generation) {
    const gen = Number(generation);
    if (!Number.isFinite(gen) || gen <= 0) return [];
    const dropped = held.filter((item) => item.generation === gen);
    held = held.filter((item) => item.generation !== gen);
    interims.delete(gen);
    drained.add(gen);
    return dropped;
  }

  function discardExcept(activeGeneration) {
    const keep = Number(activeGeneration);
    const dropped = held.filter((item) => item.generation !== keep);
    held = keep > 0 ? held.filter((item) => item.generation === keep) : [];
    for (const item of dropped) drained.add(item.generation);
    if (!(keep > 0)) {
      interims.clear();
      releasedTexts.clear();
    } else {
      for (const gen of [...interims.keys()]) {
        if (gen !== keep) interims.delete(gen);
      }
    }
    return dropped;
  }

  function reassignPending(fromGeneration, toGeneration) {
    const from = Number(fromGeneration);
    const to = Number(toGeneration);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0 || from === to) {
      return 0;
    }
    if (drained.has(from)) return 0;
    let n = 0;
    for (const item of held) {
      if (item.generation === from) {
        item.generation = to;
        n += 1;
      }
    }
    if (interims.has(from)) {
      interims.set(to, interims.get(from));
      interims.delete(from);
      n += 1;
    }
    return n;
  }

  function clear() {
    held = [];
    drained.clear();
    interims.clear();
    releasedTexts.clear();
  }

  return {
    enqueue,
    noteInterim,
    consumeInterimIfMatches,
    takeAllInterims,
    drain,
    discardGeneration,
    discardExcept,
    reassignPending,
    pendingFor,
    hasPending,
    pending,
    alreadyReleased,
    markReleased,
    clear,
  };
}

/**
 * Last complete agent question that is safe to replay.
 * A new question is only committed after its playback finishes without cancel.
 * Replay TTS must not replace the committed question.
 */
function createAgentReplayMemory() {
  let lastAgentQuestion = '';
  let pendingSpeech = '';
  let pendingIsQuestion = false;

  function beginSpeech(text, opts = {}) {
    if (opts.isFiller || opts.isReplay) {
      return snapshot();
    }
    const clean = normalizeAnswer(text);
    pendingSpeech = clean;
    pendingIsQuestion = Boolean(clean && agentAwaitingReply(clean));
    return snapshot();
  }

  function commitPlayback() {
    if (pendingIsQuestion && pendingSpeech) {
      lastAgentQuestion = pendingSpeech;
    }
    pendingSpeech = '';
    pendingIsQuestion = false;
    return snapshot();
  }

  function abandonPlayback() {
    pendingSpeech = '';
    pendingIsQuestion = false;
    return snapshot();
  }

  function pickReplay() {
    return String(lastAgentQuestion || '').trim();
  }

  function isAwaiting() {
    return Boolean(
      (pendingIsQuestion && pendingSpeech) || agentAwaitingReply(lastAgentQuestion)
    );
  }

  function snapshot() {
    return {
      lastAgentQuestion,
      lastCompleteAgentQuestion: lastAgentQuestion,
      pendingSpeech,
      pendingIsQuestion,
    };
  }

  function clear() {
    lastAgentQuestion = '';
    pendingSpeech = '';
    pendingIsQuestion = false;
  }

  return {
    beginSpeech,
    commitPlayback,
    abandonPlayback,
    rememberSelectedSpeech: beginSpeech,
    pickReplay,
    isAwaiting,
    snapshot,
    clear,
  };
}

module.exports = {
  createOverlapHold,
  createAgentReplayMemory,
};
