// Generation-tagged overlap hold + last complete agent question for Sorry/Pardon replay.
// One hold buffer per media session. Idle STT assembly stays on utteranceParts.

const { agentAwaitingReply } = require('./turnTaking');

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

  function enqueue(text, generation) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const gen = Number(generation);
    if (!clean || !Number.isFinite(gen) || gen <= 0) return null;
    const existing = held.find((item) => item.generation === gen && item.text === clean);
    if (existing) return existing;
    const item = { id: nextId++, text: clean, generation: gen };
    held.push(item);
    return item;
  }

  function pendingFor(generation) {
    const gen = Number(generation);
    return held.filter((item) => item.generation === gen).map((item) => item.text);
  }

  function pending() {
    return held.map((item) => ({ text: item.text, generation: item.generation }));
  }

  /**
   * Release caller finals held for this playback generation exactly once.
   * A second drain of the same generation is a no-op (duplicate: true).
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
    const text = items
      .map((item) => item.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, items, duplicate: false };
  }

  /** Drop held items for a generation without processing them (stale / new caller turn). */
  function discardGeneration(generation) {
    const gen = Number(generation);
    if (!Number.isFinite(gen) || gen <= 0) return [];
    const dropped = held.filter((item) => item.generation === gen);
    held = held.filter((item) => item.generation !== gen);
    drained.add(gen);
    return dropped;
  }

  /** Drop every held generation except the active playback. */
  function discardExcept(activeGeneration) {
    const keep = Number(activeGeneration);
    const dropped = held.filter((item) => item.generation !== keep);
    held = keep > 0 ? held.filter((item) => item.generation === keep) : [];
    for (const item of dropped) drained.add(item.generation);
    return dropped;
  }

  /**
   * Move undrained items from one playback onto the next (filler → reply)
   * so they still release exactly once with the surviving generation.
   */
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
    return n;
  }

  function clear() {
    held = [];
    drained.clear();
  }

  return {
    enqueue,
    drain,
    discardGeneration,
    discardExcept,
    reassignPending,
    pendingFor,
    pending,
    clear,
  };
}

/**
 * Last complete agent utterance/question selected for speech.
 * Cancellation must not overwrite this with a streamed fragment.
 */
function createAgentReplayMemory() {
  let lastCompleteAgentUtterance = '';
  let lastCompleteAgentQuestion = '';

  function rememberSelectedSpeech(text, opts = {}) {
    if (opts.isFiller) return { lastCompleteAgentQuestion, lastCompleteAgentUtterance };
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return { lastCompleteAgentQuestion, lastCompleteAgentUtterance };
    lastCompleteAgentUtterance = clean;
    if (agentAwaitingReply(clean)) lastCompleteAgentQuestion = clean;
    return snapshot();
  }

  function pickReplay(fallbackText) {
    return String(
      lastCompleteAgentQuestion || lastCompleteAgentUtterance || fallbackText || ''
    ).trim();
  }

  function snapshot() {
    return { lastCompleteAgentQuestion, lastCompleteAgentUtterance };
  }

  function clear() {
    lastCompleteAgentUtterance = '';
    lastCompleteAgentQuestion = '';
  }

  return {
    rememberSelectedSpeech,
    pickReplay,
    snapshot,
    clear,
  };
}

module.exports = {
  createOverlapHold,
  createAgentReplayMemory,
};
