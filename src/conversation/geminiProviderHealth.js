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

function getGeminiProviderHealth() {
  return {
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
}

module.exports = {
  noteGeminiProviderError,
  noteGeminiProviderOk,
  getGeminiProviderHealth,
  resetGeminiProviderHealth,
};
