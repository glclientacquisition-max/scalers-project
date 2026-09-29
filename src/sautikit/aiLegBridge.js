// Shop DID dials a second number that holds Stream connect=true.
// The caller stays on the shop leg. Shy runs on the second leg.
// Default off. Does not dial a human.

function digits(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function phonesMatch(a, b) {
  const da = digits(a);
  const db = digits(b);
  return Boolean(da && db && da === db);
}

function escapeXml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function maskE164(raw) {
  const d = digits(raw);
  if (d.length < 4) return 'hidden';
  return `***${d.slice(-4)}`;
}

function aiLegDid() {
  const raw = String(process.env.VOICE_AI_LEG_DID || '').trim();
  return raw || null;
}

function parentDidForTenant() {
  const raw = String(process.env.VOICE_AI_LEG_PARENT_DID || '').trim();
  return raw || null;
}

function aiLegBridgeEnabled() {
  const on = String(process.env.VOICE_AI_LEG_BRIDGE || '').toLowerCase() === 'on';
  return on && Boolean(aiLegDid()) && Boolean(parentDidForTenant());
}

function isAiLegDestination(toNumber) {
  return Boolean(aiLegDid()) && phonesMatch(toNumber, aiLegDid());
}

function shouldDialAiLeg(toNumber) {
  return aiLegBridgeEnabled() && phonesMatch(toNumber, parentDidForTenant());
}

const bridgedShopCalls = new Set();

function rememberShopBridge(callSid) {
  const sid = String(callSid || '').trim();
  if (sid) bridgedShopCalls.add(sid);
}

function shopBridgeAlready(callSid) {
  return bridgedShopCalls.has(String(callSid || '').trim());
}

function resetAiLegBridgeForTests() {
  bridgedShopCalls.clear();
}

function isDialFinishedState(callSessionState) {
  const state = String(callSessionState || '').toLowerCase();
  return state.includes('dialcompleted') || state.includes('dial-completed');
}

function decideShopBridge({ callSid, callSessionState, toNumber } = {}) {
  if (isDialFinishedState(callSessionState)) return 'dial_finished';
  if (shopBridgeAlready(callSid)) return 'already';
  if (shouldDialAiLeg(toNumber)) return 'dial';
  return 'stream';
}

function buildStillHereXml() {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Say>Still here.</Say>\n` +
    `</Response>`
  );
}

function aiLegDropMs() {
  const n = Number(process.env.VOICE_AI_LEG_DROP_MS || 0);
  if (!Number.isFinite(n) || n < 5000) return 0;
  return Math.min(120000, Math.floor(n));
}

function buildShopBridgeXml({ aiLeg, callerId, doneUrl, timeoutS = 600 } = {}) {
  const dest = escapeXml(aiLeg);
  const from = escapeXml(callerId || '');
  const next = escapeXml(doneUrl);
  const timeout = Math.min(3600, Math.max(30, Number(timeoutS) || 600));
  const callerAttr = from ? ` callerId="${from}"` : '';
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Response>\n` +
    `  <Dial${callerAttr} timeout="${timeout}" record="true"><Number>${dest}</Number></Dial>\n` +
    `  <Redirect method="POST">${next}</Redirect>\n` +
    `</Response>`
  );
}

function aiLegHealth() {
  return {
    bridge: aiLegBridgeEnabled(),
    leg: maskE164(aiLegDid()),
    parent: maskE164(parentDidForTenant()),
    dropMs: aiLegDropMs(),
  };
}

module.exports = {
  aiLegDid,
  parentDidForTenant,
  aiLegBridgeEnabled,
  isAiLegDestination,
  shouldDialAiLeg,
  rememberShopBridge,
  decideShopBridge,
  buildStillHereXml,
  buildShopBridgeXml,
  aiLegDropMs,
  aiLegHealth,
  phonesMatch,
  resetAiLegBridgeForTests,
};
