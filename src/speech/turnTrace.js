// Stage notes live next to the stage they describe.
// createVoiceTrace still writes the record. The JSON shape does not change.
// Gemini Live, when its flag is on, only changes the model provider string.

const { modelStageProvider } = require('./geminiLive');

function traceStt(trace, evt = {}) {
  trace?.noteStt?.(evt);
}

function traceTurnEnd(trace, info = {}) {
  trace?.noteTurnEnd?.(info);
}

function traceLanguage(trace, info = {}) {
  trace?.noteLanguage?.(info);
}

function traceModelRequest(trace, info = {}) {
  trace?.noteModelRequest?.({
    ...info,
    provider: modelStageProvider(info.provider || 'gemini'),
  });
}

function traceModelOutput(trace, info = {}) {
  trace?.noteModelOutput?.({
    ...info,
    provider: modelStageProvider(info.provider || 'gemini'),
  });
}

function traceTransform(trace, info = {}) {
  trace?.noteTransform?.(info);
}

function traceCanned(trace, info = {}) {
  trace?.noteCanned?.(info);
}

function traceTts(trace, info = {}) {
  trace?.noteTts?.(info);
}

function traceBarge(trace, info = {}) {
  trace?.noteBarge?.(info);
}

function traceCall(trace, stage = {}) {
  trace?.noteCall?.(stage);
}

module.exports = {
  traceStt,
  traceTurnEnd,
  traceLanguage,
  traceModelRequest,
  traceModelOutput,
  traceTransform,
  traceCanned,
  traceTts,
  traceBarge,
  traceCall,
};
