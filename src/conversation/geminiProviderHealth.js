// Process-wide last Gemini turn error. Exposed on GET /healthz so ops can
// tell a credits/denied outage from a transient 429 without tailing logs.

const {
  notePlatformOpsDegrade,
  notePlatformOpsRecovered,
} = require('../notifications/platformOpsAlert');

/** @type {{ kind: string|null, message: string|null, at: string|null }|null} */
let lastError = null;
/** @type {{ at: string|null }} */
let lastOk = { at: null };

function isReasoningOutage(kind) {
  return kind === 'billing' || kind === 'denied';
}

function noteGeminiProviderError(classified, err) {
  if (!classified) return;
  const wasOutage = isReasoningOutage(lastError?.kind);
  const kind = classified.kind || 'error';
  lastError = {
    kind,
    retryable: Boolean(classified.retryable),
    message: String(err?.message || err || '').slice(0, 200),
    at: new Date().toISOString(),
  };
  if (isReasoningOutage(kind) && !wasOutage) {
    void notePlatformOpsDegrade('reasoning', {
      channel: kind,
      message: lastError.message,
    }).catch((alertErr) => {
      console.warn('[gemini] platform ops alert failed:', alertErr?.message || alertErr);
    });
  }
}

function noteGeminiProviderOk() {
  lastOk = { at: new Date().toISOString() };
  const wasOutage = isReasoningOutage(lastError?.kind);
  if (lastError?.kind === 'billing' || lastError?.kind === 'denied') return;
  lastError = null;
  if (wasOutage) {
    notePlatformOpsRecovered('reasoning');
  }
}

// Brain v2 turn models (BRAIN_V1_DRAFT draft stream, v2 turn model) use their own stream clients;
// they report here so /healthz shows the model the call actually uses.
/** @type {{ lastOkAt: string|null, model: string|null, lastError: { message: string, at: string, model: string|null }|null }} */
let brain = { lastOkAt: null, model: null, lastError: null };
function noteBrainModel({ ok, model = null, err = null } = {}) {
  if (ok) { brain = { ...brain, lastOkAt: new Date().toISOString(), model: model || brain.model }; noteGeminiProviderOk(); return; }
  brain = { ...brain, lastError: { message: String(err || '').slice(0, 120), at: new Date().toISOString(), model } };
}

function getGeminiProviderHealth() {
  return {
    brain: { ...brain },
    lastError,
    lastOkAt: lastOk.at,
    billingExhausted: lastError?.kind === 'billing',
    denied: lastError?.kind === 'denied',
  };
}

/** Tests only. */
function resetGeminiProviderHealth() {
  lastError = null;
  lastOk = { at: null };
  brain = { lastOkAt: null, model: null, lastError: null };
}

module.exports = {
  noteGeminiProviderError,
  noteGeminiProviderOk,
  getGeminiProviderHealth,
  noteBrainModel,
  resetGeminiProviderHealth,
};
