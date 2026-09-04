// Classify Soniox STT/TTS websocket errors. Billing 402 is the live
// "assistant answered but never spoke" failure (balance exhausted).

function asObject(input) {
  if (!input) return {};
  if (typeof input === 'string') return { message: input };
  if (input instanceof Error) return { message: input.message, error_code: input.code };
  if (typeof input === 'object') return input;
  return { message: String(input) };
}

function classifySonioxError(input) {
  const raw = asObject(input);
  const codeRaw = raw.error_code ?? raw.status ?? raw.code;
  const codeNum = Number(codeRaw);
  const code = Number.isFinite(codeNum) && codeNum > 0 ? codeNum : null;
  const type = raw.error_type ? String(raw.error_type) : null;
  const message = String(
    raw.error_message || raw.message || raw.text || ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  const billing =
    code === 402 ||
    /balance exhausted|add funds|enable autopay|payment required|insufficient (credit|fund|balance)/i.test(
      message
    );

  // After barge-in cancel, Soniox replies 400 "Stream … not found".
  // That is one dead stream, not a dead provider (live miss: HD_5de59f6babc7).
  const staleStream =
    !billing &&
    (code === 400 || code === null) &&
    /stream .+ not found|send a start message first/i.test(message);

  return {
    billing,
    fatal: billing || code === 401 || code === 403,
    staleStream,
    code,
    type,
    message: message.slice(0, 240) || 'Soniox error',
  };
}

function isSonioxBillingError(input) {
  return classifySonioxError(input).billing;
}

module.exports = {
  classifySonioxError,
  isSonioxBillingError,
};
