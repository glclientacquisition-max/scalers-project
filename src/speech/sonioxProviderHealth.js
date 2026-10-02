// Process-wide last Soniox STT/TTS error. Exposed on GET /healthz so ops
// can see billing exhaustion without tailing Railway logs.

const {
  notePlatformOpsDegrade,
  notePlatformOpsRecovered,
} = require('../notifications/platformOpsAlert');

/** @type {{ stt: object|null, tts: object|null }} */
const last = { stt: null, tts: null };

function snapshot(classified, extra = {}) {
  if (!classified) return null;
  return {
    billing: Boolean(classified.billing),
    fatal: Boolean(classified.fatal),
    code: classified.code || null,
    type: classified.type || null,
    message: classified.message || null,
    at: extra.at || new Date().toISOString(),
  };
}

function noteSonioxProviderError(channel, classified) {
  const key = channel === 'stt' ? 'stt' : 'tts';
  const wasBilling = Boolean(last.stt?.billing || last.tts?.billing);
  if (last[key]?.billing && !classified?.billing) return;
  last[key] = snapshot(classified);
  if (classified?.billing) {
    console.error(
      `[soniox] BILLING EXHAUSTED channel=${key} code=${classified.code || '?'} ${classified.message}`
    );
    if (!wasBilling) {
      void notePlatformOpsDegrade('speech', {
        channel: key,
        message: classified.message,
      }).catch((err) => {
        console.warn('[soniox] platform ops alert failed:', err?.message || err);
      });
    }
  }
}

function noteSonioxProviderOk(channel) {
  const key = channel === 'stt' ? 'stt' : 'tts';
  const wasBilling = Boolean(last.stt?.billing || last.tts?.billing);
  if (last[key]?.billing || last[key]?.fatal) {
    last[key] = {
      billing: false,
      fatal: false,
      code: null,
      type: null,
      message: 'ok',
      at: new Date().toISOString(),
    };
  }
  const stillBilling = Boolean(last.stt?.billing || last.tts?.billing);
  if (wasBilling && !stillBilling) {
    notePlatformOpsRecovered('speech');
  }
}

function getSonioxProviderHealth() {
  return {
    stt: last.stt,
    tts: last.tts,
    billingExhausted: Boolean(last.stt?.billing || last.tts?.billing),
  };
}

function isSonioxBillingExhausted() {
  return Boolean(last.stt?.billing || last.tts?.billing);
}

/** Tests only. */
function resetSonioxProviderHealth() {
  last.stt = null;
  last.tts = null;
}

module.exports = {
  noteSonioxProviderError,
  noteSonioxProviderOk,
  getSonioxProviderHealth,
  isSonioxBillingExhausted,
  resetSonioxProviderHealth,
};
