'use strict';
// B2 follow-up (#1010): a brain error must never go silent for the owner.
//
// Who tells the owner, by case:
//   - the brain-error follow-up row SAVED (outcome brain_error): the executor's per-request alert on that row, as for
//     any callback (server.js maybeSendServiceRequestNotification). With OWNER_SUMMARY_SUPPRESS_LEGACY on AND the
//     end-of-call summary on (CALL_SUMMARY_EVENT + OWNER_CALL_SUMMARY), that per-request SMS folds into the one
//     summary ("Call back needed: ..." + the callback receipt). The suppression only bites while the summary sender
//     is on (ownerCallSummary.legacyOwnerSendsSuppressed), so a saved row always alerts one way or the other.
//   - NOTHING saved (the follow-up save failed, or a failed write's owner fallback failed: outcome write_failed):
//     there is no row, so no per-request alert. When no end-of-call summary will be sent, this module sends one
//     direct owner-only alert (no caller SMS: nothing was saved). With the summary on, the summary carries it.
// Once per call. Never throws.
const { ownerCallSummaryEnabled, legacyOwnerSendsSuppressed } = require('./ownerCallSummary');
const { serviceRequestEvent, renderEventText, renderEventSubject } = require('./events');

const TITLE = 'Call back needed: request NOT saved';

/** Pure: how the owner hears about a brain-error / not-saved follow-up. */
function brainErrorAlertPlan({ saved, env } = {}) {
  const summary = ownerCallSummaryEnabled(env);
  if (saved) return { via: legacyOwnerSendsSuppressed(env) ? 'summary' : 'request_alert', summary };
  return { via: summary ? 'summary' : 'direct_alert', summary };
}

function createBrainErrorAlerter({ db, dispatchToStaff, staffRecipients, env = null, log = console, maxCalls = 5000 } = {}) {
  const done = new Map();
  return async function alertBrainError(callSid, rec = {}) {
    const plan = brainErrorAlertPlan({ saved: Boolean(rec && rec.ok), env: env || undefined });
    if (plan.via !== 'direct_alert') return { sent: false, via: plan.via };
    if (!callSid) return { sent: false, via: plan.via, reason: 'no_call' };
    if (done.has(callSid)) return { ...(await done.get(callSid)), once: false };
    const p = (async () => {
      try {
        const profile = (await db.getTenantProfile({ callSid }).catch(() => null)) || {};
        const call = (await db.getCall(callSid).catch(() => null)) || {};
        const phone = rec.phone || call.from_number || call.caller_number || null;
        const request = {
          request_type: 'callback',
          caller_name: rec.name || call.name || null,
          caller_phone: phone,
          notes: `The assistant hit a problem and could NOT save this caller's request (${rec.kind || 'turn'}${rec.error ? `: ${rec.error}` : ''}). Please call them back.`,
        };
        const event = { ...serviceRequestEvent(request, profile.businessName || 'your business'), title: TITLE };
        const inbox = staffRecipients('inbox', { teamDirectory: profile.teamDirectory || [], ownerPhone: profile.whatsappNumber || null, ownerEmail: profile.alertEmail || null });
        const { sent } = await dispatchToStaff({
          recipients: inbox.recipients,
          body: renderEventText(event),
          subject: renderEventSubject(event),
          lead: { businessName: profile.businessName || null, name: request.caller_name || 'Caller', reason: TITLE, callerNumber: phone },
          channels: profile.notifyChannels || null,
          alertType: 'booking',
          ledger: { tenantId: profile.id || call.tenant_id || null, callId: call.id || null, callSid, kind: 'brain_error' },
        });
        const first = (sent || [])[0];
        log.log?.(`[${callSid}] brain_error direct owner alert ${first?.channel ? `via ${first.channel}` : 'NOT sent (no channel)'}`);
        return { sent: Boolean(first?.channel), via: 'direct_alert', channel: first?.channel || null };
      } catch (err) {
        log.warn?.(`[${callSid}] brain_error direct owner alert failed:`, err?.message || err);
        return { sent: false, via: 'direct_alert', error: String(err?.message || err).slice(0, 80) };
      }
    })();
    done.set(callSid, p);
    if (done.size > maxCalls) done.delete(done.keys().next().value);
    return { ...(await p), once: true };
  };
}

module.exports = { brainErrorAlertPlan, createBrainErrorAlerter, TITLE };
