// VOICE_QUERY_BATCHING call start (N+1 audit #1): the tenant profile and the
// returning-caller card load side by side instead of one after another.
//
// Off path (server.js ensureTenantPrompt, unchanged): wait for the webhook's
// call row, then getTenantProfile (tenant row, visits, service areas,
// field meta, hold gate, unknown line: one after another), then the card
// (getCall, contact, five card reads one after another). 9-18 round trips in
// series before the greeting.
//
// On: getTenantProfile (batched inside db.js: about one round trip) starts at
// once with the tenant the webhook resolved. The card waits only for the call
// row the webhook is already writing (no getCall), then reads contact + the
// card in parallel. The greeting waits for the slower of the two.

/**
 * @param {{
 *   callSid: string,
 *   inboundCalls: { tenantIdFor: Function, awaitRow: Function },
 *   db: { getTenantProfile: Function },
 *   hydrateCallerMemory: (profile: object, callSid: string, callRow?: object|null) => Promise<object>,
 *   awaitRowMs?: number,
 *   now?: () => number,
 * }} deps
 * @returns {Promise<{ profile: object, ms: number, tenantFromWebhook: boolean }>}
 */
async function loadCallStartProfile({
  callSid,
  inboundCalls,
  db,
  hydrateCallerMemory,
  awaitRowMs = 2500,
  now = () => Date.now(),
}) {
  const t0 = now();
  const tenantId = inboundCalls.tenantIdFor(callSid) || null;
  const rowPromise = Promise.resolve(inboundCalls.awaitRow(callSid, awaitRowMs)).catch(() => null);

  if (!tenantId) {
    // No webhook tenant: the call row names it. Wait for the row as the off
    // path does, and pass its tenant so getTenantProfile skips getCall.
    const row = await rowPromise;
    const profile = await db.getTenantProfile({
      callSid,
      tenantId: row?.tenant_id || undefined,
    });
    await hydrateCallerMemory(profile, callSid, row);
    return { profile, ms: now() - t0, tenantFromWebhook: false };
  }

  // The card is keyed by the same tenant id the profile resolves to
  // (attachCallerMemory uses profile.id), so it can start now.
  const cardHolder = { id: tenantId };
  const [profile] = await Promise.all([
    db.getTenantProfile({ callSid, tenantId }),
    rowPromise.then((row) => hydrateCallerMemory(cardHolder, callSid, row)),
  ]);
  if (cardHolder.callerMemory) profile.callerMemory = cardHolder.callerMemory;
  else delete profile.callerMemory;
  return { profile, ms: now() - t0, tenantFromWebhook: true };
}

module.exports = { loadCallStartProfile };
