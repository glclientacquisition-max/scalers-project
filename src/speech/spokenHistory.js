// What the caller heard, in the model's history.
//
// HD_ceba9d9b3f37: the confirm read-out, the file-name ask and the canned
// service list went straight to TTS and only into the transcript. The model
// never saw them, so on "Okay, thank you." it read both visits and the whole
// service list again. Every line the code speaks (not the model) goes through
// recordSpokenLine, so the next model turn knows what was already said.
//
// Code-spoken lines carry no Gemini thought signature, so they cannot be
// replayed as model turns (Gemini 3 answers 400, see buildGeminiContents).
// They stay local: true and are shown to the model as a note on the user
// side of the conversation, in order (spokenLineNote).

const SPOKEN_SOURCE_DEFAULT = 'canned';

/**
 * Append one code-spoken line to the model history.
 * @param {Array<object>} messages the call's model history
 * @param {string} line exactly what was sent to TTS
 * @param {{ source?: string }} [opts] where it came from (visit_read, file_name_ask, catalogue, ...)
 * @returns {boolean} true when a row was added
 */
function recordSpokenLine(messages, line, opts = {}) {
  if (!Array.isArray(messages)) return false;
  const text = String(line || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const last = messages[messages.length - 1];
  // The same line twice in a row is one utterance (a retry, a replay).
  if (last && last.role === 'assistant' && last.spoken === true && last.content === text) return false;
  messages.push({
    role: 'assistant',
    content: text,
    local: true,
    spoken: true,
    source: String(opts.source || SPOKEN_SOURCE_DEFAULT),
  });
  return true;
}

/**
 * Did the caller hear (at least the start of) this line? speakText returns
 * { ok: true } once the stream played, also when a barge cut its tail.
 * Gated, cancelled-before-audio, call-over and outage results were not heard.
 * @param {{ ok?: boolean }|null|undefined} spoken
 */
function spokenLineReachedCaller(spoken) {
  return Boolean(spoken && spoken.ok === true);
}

/**
 * The user-side note that carries a code-spoken line to the model.
 * @param {string} text
 */
function spokenLineNote(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return `[You already said this to the caller, word for word: "${t}"]`;
}

/** True for a history row written by recordSpokenLine. */
function isSpokenLine(message) {
  return Boolean(message && message.role === 'assistant' && message.local === true && message.spoken === true);
}

module.exports = {
  recordSpokenLine,
  spokenLineReachedCaller,
  spokenLineNote,
  isSpokenLine,
};
