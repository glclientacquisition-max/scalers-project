// Gate live Soniox PCM onto the media bridge, and decide what a barge does
// to the in-flight utterance. Soniox treats each flushed chunk as a finished
// utterance, so a cancelled tail must not open a new stream.

/**
 * Forward a PCM frame only for the stream that currently owns playback.
 * A null active id (cancel, or the gap before the next stream is bound)
 * drops orphan audio from the stream we just killed.
 *
 * @param {{
 *   speaking?: boolean,
 *   playbackGeneration?: number,
 *   activePlaybackGeneration?: number,
 *   activeStreamId?: string|null,
 *   frameStreamId?: string|null
 * }} opts
 */
function shouldForwardOutboundPcm(opts = {}) {
  if (!opts.speaking) return false;
  if (Number(opts.activePlaybackGeneration) !== Number(opts.playbackGeneration)) return false;
  const active = opts.activeStreamId ? String(opts.activeStreamId) : '';
  const frame = opts.frameStreamId ? String(opts.frameStreamId) : '';
  if (!active || !frame) return false;
  return active === frame;
}

/**
 * Real barge (stopTts + interrupt) clears TTS and queued media.
 * Echo and backchannel keep the current sentence playing.
 *
 * @param {{ stopTts?: boolean, interrupt?: boolean }} decision
 */
function planBargePlayback(decision = {}) {
  const cancel = decision.stopTts === true && decision.interrupt === true;
  return {
    cancelTts: cancel,
    clearMedia: cancel,
    dropOrphanPcm: cancel,
    keepStream: !cancel,
  };
}

/**
 * A mid-phrase tail of the line we just cancelled. A new sentence
 * (ends with . ! or ?) is a fresh stream, not a fragment restart.
 *
 * @param {string} cancelledText
 * @param {string} nextChunk
 */
function isOrphanFragment(cancelledText, nextChunk) {
  const cancelled = String(cancelledText || '').replace(/\s+/g, ' ').trim();
  const next = String(nextChunk || '').replace(/\s+/g, ' ').trim();
  if (!cancelled || !next) return false;
  if (/[.!?]$/.test(next)) return false;
  const cancelledCore = cancelled.replace(/[.!?]+$/g, '').trim();
  const nextCore = next.replace(/[.!?]+$/g, '').trim();
  const nextWords = nextCore.split(/\s+/).filter(Boolean);
  const cancelledWords = cancelledCore.split(/\s+/).filter(Boolean);
  if (nextWords.length < 2 || nextWords.length >= cancelledWords.length) return false;
  return cancelledCore.toLowerCase().endsWith(nextCore.toLowerCase());
}

/**
 * After a real barge, the next reply is a new Soniox stream of whole
 * sentences. Drop any leftover tail from the cancelled utterance.
 *
 * @param {{
 *   cancelledStreamId?: string|null,
 *   nextStreamId?: string|null,
 *   cancelledText?: string,
 *   sentences?: string[]
 * }} opts
 */
function planNextReplyAfterBarge(opts = {}) {
  const nextStreamId = opts.nextStreamId ? String(opts.nextStreamId) : '';
  const cancelledStreamId = opts.cancelledStreamId ? String(opts.cancelledStreamId) : '';
  const freshStream = Boolean(nextStreamId) && nextStreamId !== cancelledStreamId;
  const cancelledText = String(opts.cancelledText || '');
  const sentences = [];
  for (const raw of opts.sentences || []) {
    const sentence = String(raw || '').trim();
    if (!sentence) continue;
    if (isOrphanFragment(cancelledText, sentence)) continue;
    sentences.push(sentence);
  }
  return {
    clearTts: true,
    clearMedia: true,
    freshStream,
    sentences: freshStream ? sentences : [],
  };
}

module.exports = {
  shouldForwardOutboundPcm,
  planBargePlayback,
  isOrphanFragment,
  planNextReplyAfterBarge,
};
