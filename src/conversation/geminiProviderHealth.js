// Process-wide last Gemini turn error. Exposed on GET /healthz so ops can
// tell a credits/denied outage from a transient 429 without tailing logs.

/** @type {{ kind: string|null, message: string|null, at: string|null }|null} */
let lastError = null;
/** @type {{ at: string|null }} */
let lastOk = { at: null };

function noteGeminiProviderError(classified, err) {
  if (!classified) return;
  lastError = {
    kind: classified.kind || 'error',
    retryable: Boolean(classified.retryable),
    message: String(err?.message || err || '').slice(0, 200),
    at: new Date().toISOString(),
  };
}

function noteGeminiProviderOk() {
  lastOk = { at: new Date().toISOString() };
  if (lastError?.kind === 'billing' || lastError?.kind === 'denied') return;
  lastError = null;
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
