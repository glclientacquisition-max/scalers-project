// Lightweight per-turn voice latency markers for Railway logs.

/**
 * @param {string} callSid
 * @param {{ turnStartedAt?: number }} [opts]
 */
function createVoiceTurnTiming(callSid, opts = {}) {
  const turnStartedAt = Number(opts.turnStartedAt || Date.now());
  /** @type {number|null} */
  let llmStartedAt = null;
  /** @type {number|null} */
  let firstChunkAt = null;
  /** @type {number|null} */
  let firstPcmAt = null;
  let fillerUsed = false;

  function markLlmStart() {
    if (llmStartedAt == null) llmStartedAt = Date.now();
  }

  function markFirstSpokenChunk() {
    if (firstChunkAt == null) firstChunkAt = Date.now();
  }

  function markFirstPcm() {
    if (firstPcmAt == null) firstPcmAt = Date.now();
  }

  function markFiller() {
    fillerUsed = true;
  }

  function msFrom(start, end) {
    if (start == null || end == null) return null;
    return Math.max(0, end - start);
  }

  function summary(extra = {}) {
    const endedAt = Date.now();
    return {
      callSid: String(callSid || 'unknown'),
      turn_ms: msFrom(turnStartedAt, endedAt),
      endpoint_to_llm_ms: msFrom(turnStartedAt, llmStartedAt),
      first_chunk_ms: msFrom(turnStartedAt, firstChunkAt),
      first_pcm_ms: msFrom(turnStartedAt, firstPcmAt),
      chunk_to_pcm_ms: msFrom(firstChunkAt, firstPcmAt),
      filler: fillerUsed ? 1 : 0,
      ...extra,
    };
  }

  function log(extra = {}) {
    const s = summary(extra);
    console.log(
      `[voice-timing][${s.callSid}]` +
        ` turn_ms=${s.turn_ms}` +
        ` endpoint_to_llm_ms=${s.endpoint_to_llm_ms ?? '-'}` +
        ` first_chunk_ms=${s.first_chunk_ms ?? '-'}` +
        ` first_pcm_ms=${s.first_pcm_ms ?? '-'}` +
        ` chunk_to_pcm_ms=${s.chunk_to_pcm_ms ?? '-'}` +
        ` filler=${s.filler}` +
        (extra.outcome ? ` outcome=${extra.outcome}` : '')
    );
    return s;
  }

  return {
    markLlmStart,
    markFirstSpokenChunk,
    markFirstPcm,
    markFiller,
    summary,
    log,
    get turnStartedAt() {
      return turnStartedAt;
    },
  };
}

module.exports = {
  createVoiceTurnTiming,
};
