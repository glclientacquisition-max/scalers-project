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

/**
 * Persistable first-audio latency for transcripts.latency_ms.
 * Prefer first PCM (audible) over first spoken chunk.
 * @param {{ first_pcm_ms?: number|null, first_chunk_ms?: number|null }} summary
 * @returns {number|null}
 */
function persistableLatencyMs(summary = {}) {
  const n = summary.first_pcm_ms ?? summary.first_chunk_ms;
  if (n == null || !Number.isFinite(Number(n))) return null;
  return Math.max(0, Math.round(Number(n)));
}

/**
 * Structured media-call transcript so appendTranscript can write latency_ms.
 */
function createCallTranscript() {
  /** @type {{ speaker: string, text: string, latencyMs: number|null }[]} */
  const rows = [];

  function push(speaker, text) {
    const clean = String(text || '').trim();
    if (!clean) return null;
    const row = { speaker, text: clean, latencyMs: null };
    rows.push(row);
    return row;
  }

  function stampFirstAgentSince(startIndex, latencyMs) {
    if (latencyMs == null || !Number.isFinite(Number(latencyMs))) return null;
    const ms = Math.max(0, Math.round(Number(latencyMs)));
    const start = Math.max(0, Number(startIndex) || 0);
    for (let i = start; i < rows.length; i += 1) {
      if (rows[i].speaker === 'agent' && rows[i].latencyMs == null) {
        rows[i].latencyMs = ms;
        return rows[i];
      }
    }
    return null;
  }

  function stampFromSummary(summary) {
    const ms = persistableLatencyMs(summary);
    let since = 0;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i].speaker === 'caller') {
        since = i;
        break;
      }
    }
    return stampFirstAgentSince(since, ms);
  }

  return {
    pushCaller(text) {
      return push('caller', text);
    },
    pushAgent(text) {
      return push('agent', text);
    },
    stampFirstAgentSince,
    stampFromSummary,
    size() {
      return rows.length;
    },
    turns() {
      return rows.map((row) => ({ ...row }));
    },
  };
}

module.exports = {
  createVoiceTurnTiming,
  persistableLatencyMs,
  createCallTranscript,
};
