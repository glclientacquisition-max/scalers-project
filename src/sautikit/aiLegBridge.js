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
  };
}

module.exports = {
  aiLegDid,
  parentDidForTenant,
  aiLegBridgeEnabled,
  isAiLegDestination,
  shouldDialAiLeg,
  buildShopBridgeXml,
  aiLegHealth,
  phonesMatch,
};
