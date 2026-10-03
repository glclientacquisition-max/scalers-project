// Shared media-socket cancel for barge-in and a future node change.
// Voice owns this. Brain does not call it.
// Already-sent PCM cannot be pulled back. killAudio drops only what the
// bridge still has queued. STT stays up.

/**
 * Which TTS stream a cancel may stop.
 * Only the stream that is actually playing. A prefetched reply that has
 * not been bound as playback is left alone. Arming and cached-filler ids
 * are not Soniox streams.
 *
 * @param {{
 *   activeOutboundStreamId?: string|null,
 *   prefetchStreamId?: string|null,
 *   playbackGeneration?: number,
 * }} [state]
 */
function planVoiceSocketCancel(state = {}) {
  const playingId = state.activeOutboundStreamId
    ? String(state.activeOutboundStreamId)
    : '';
  const prefetchId = state.prefetchStreamId ? String(state.prefetchStreamId) : '';
  // Same rule as isCancelableTtsStreamId: only a live Soniox id (tts-…).
  // Arming and cached-filler ids are not remote streams.
  const cancelTtsId = playingId.startsWith('tts-') ? playingId : null;
  const untouchedPrefetchId =
    prefetchId && prefetchId !== cancelTtsId ? prefetchId : '';
  return {
    cancelTtsId,
    untouchedPrefetchId,
    killAudio: true,
    playbackGeneration: Number(state.playbackGeneration || 0) + 1,
    speaking: false,
    turnBusy: false,
    keepStt: true,
    abortGemini: true,
    skipToolApply: true,
  };
}

/**
 * Apply the cancel plan. Aborts the in-flight Gemini request, cancels only
 * the playing Soniox stream id, and asks the bridge to drop queued audio.
 * Does not close STT. Does not cancel a prefetch id that is not playing.
 *
 * @param {object} ctx
 * @param {string} [reason]
 */
function applyVoiceSocketCancel(ctx, reason) {
  const plan = planVoiceSocketCancel(ctx);
  ctx.bargeInActive = true;
  ctx.suppressReplyRemainder = true;
  ctx.playbackGeneration = plan.playbackGeneration;
  ctx.speaking = false;
  ctx.turnBusy = false;
  ctx.fillerStreamId = null;
  ctx.activeOutboundStreamId = null;
  ctx.interimBargeText = '';
  ctx.lastVoiceCancelReason = reason || '';
  if (typeof ctx.abandonPlayback === 'function') {
    try {
      ctx.abandonPlayback();
    } catch {
      /* ignore */
    }
  }
  if (ctx.geminiAbort && typeof ctx.geminiAbort.abort === 'function') {
    try {
      ctx.geminiAbort.abort();
    } catch {
      /* ignore */
    }
  }
  if (plan.cancelTtsId && ctx.tts && typeof ctx.tts.cancel === 'function') {
    try {
      ctx.tts.cancel(plan.cancelTtsId);
    } catch {
      /* ignore */
    }
  }
  if (typeof ctx.clearMediaPlayback === 'function') {
    ctx.clearMediaPlayback();
  }
  return plan;
}

module.exports = {
  planVoiceSocketCancel,
  applyVoiceSocketCancel,
};
