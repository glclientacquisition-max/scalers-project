// src/sautikit/whatsappInbound.js
// Phase 0 dual-use (until a second DID exists):
//   Voice DID +254709221536 still resolves to Done and Dusted via resolveTenantId.
//   WhatsApp Cloud API on the same E.164 is Scalers (platform).
// Inbound chat MUST route on Meta phone_number_id, never resolveTenantId(DID).
// Phase 2: move Done and Dusted voice to a new DID, then point Scalers tenant at 0709221536.
// Do not enable WhatsApp Calling. Do not DELETE the SautiKit number.

const PLATFORM_WHATSAPP_PHONE_NUMBER_ID = '1237105982825100';
const PLATFORM_WHATSAPP_E164 = '+254709221536';
const PLATFORM_SAUTIKIT_NUMBER_ID = '81424fbd-8f4c-459a-858d-98ced4393df6';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACK = 'Got it. A Scalers teammate will follow up.';

function platformPhoneNumberId() {
  return (
    String(process.env.SAUTIKIT_WHATSAPP_PHONE_NUMBER_ID || '').trim() ||
    String(process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID || '').trim() ||
    PLATFORM_WHATSAPP_PHONE_NUMBER_ID
  );
}

function isWhatsAppEventKind(req) {
  const headers = req?.headers || {};
  const body = req?.body || {};
  const kind = String(
    headers['x-sautikit-event-kind'] ||
      headers['X-Sautikit-Event-Kind'] ||
      body.kind ||
      body.event_kind ||
      body.event_type ||
      ''
  ).toLowerCase();
  if (kind === 'whatsapp.event.received' || kind.startsWith('whatsapp.')) return true;
  if (body.object === 'whatsapp_business_account') return true;
  return false;
}

function isWhatsAppCallingChange(change) {
  const field = String(change?.field || '').toLowerCase();
  if (field === 'calls' || field.includes('call_permission')) return true;
  if (Array.isArray(change?.value?.calls) && change.value.calls.length) return true;
  return false;
}

function routePlatformWhatsApp(phoneNumberId) {
  const id = String(phoneNumberId || '').trim();
  if (!id) return { identity: null, ignore: true, reason: 'missing_phone_number_id' };
  if (id === platformPhoneNumberId()) {
    return { identity: 'platform', ignore: false, phoneNumberId: id };
  }
  return { identity: 'unknown', ignore: true, reason: 'not_platform_waba', phoneNumberId: id };
}

function createWhatsAppDedupe() {
  const seen = new Set();
  return {
    remember(id) {
      const key = String(id || '').trim();
      if (!key) return false;
      if (seen.has(key)) return true;
      seen.add(key);
      if (seen.size > 8000) {
        const first = seen.values().next().value;
        seen.delete(first);
      }
      return false;
    },
  };
}

const defaultDedupe = createWhatsAppDedupe();

function isWhatsAppSessionOpen(lastInboundAt, now = new Date()) {
  if (!lastInboundAt) return false;
  const then = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
  if (Number.isNaN(then.getTime())) return false;
  const ts = now instanceof Date ? now : new Date(now);
  return ts.getTime() - then.getTime() < WINDOW_MS;
}

function parseWhatsAppReceived(body) {
  const inbound = [];
  const statuses = [];
  const calling = [];
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (isWhatsAppCallingChange(change)) {
        calling.push(change);
        continue;
      }
      const value = change?.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
      const display = String(value.metadata?.display_phone_number || '').trim();
      for (const msg of Array.isArray(value.messages) ? value.messages : []) {
        inbound.push({
          phoneNumberId,
          displayPhone: display,
          wamid: String(msg.id || '').trim(),
          from: String(msg.from || '').trim(),
          timestamp: msg.timestamp || null,
          type: msg.type || 'text',
          body: msg.text?.body || msg.button?.text || '',
          contactName: value.contacts?.[0]?.profile?.name || null,
          raw: msg,
        });
      }
      for (const st of Array.isArray(value.statuses) ? value.statuses : []) {
        statuses.push({
          phoneNumberId,
          wamid: String(st.id || '').trim(),
          status: st.status || null,
          recipientId: String(st.recipient_id || '').trim(),
          timestamp: st.timestamp || null,
          raw: st,
        });
      }
    }
  }
  return { inbound, statuses, calling };
}

function inboundAckBody() {
  const custom = String(process.env.PLATFORM_WHATSAPP_ACK || '').trim();
  return custom || DEFAULT_ACK;
}

function inboundAckEnabled() {
  const raw = String(process.env.WHATSAPP_INBOUND_ACK || 'on').toLowerCase();
  return raw !== 'off' && raw !== 'false' && raw !== '0';
}

/**
 * Persist + mark-read + session-window text reply for platform WABA inbound.
 * Inject persist/send in tests. Never looks up tenants by DID.
 */
async function processWhatsAppReceived(opts = {}) {
  const parsed = parseWhatsAppReceived(opts.body || {});
  const dedupe = opts.dedupe || defaultDedupe;
  const persistInbound = opts.persistInbound;
  const persistStatus = opts.persistStatus;
  const markRead = opts.markRead;
  const sendText = opts.sendText;

  let handled = 0;
  let ignored = 0;
  let duplicates = 0;
  let calling = parsed.calling.length;

  for (const msg of parsed.inbound) {
    const route = routePlatformWhatsApp(msg.phoneNumberId);
    if (route.ignore) {
      ignored += 1;
      continue;
    }
    if (!msg.wamid) {
      ignored += 1;
      continue;
    }
    if (dedupe.remember(msg.wamid)) {
      duplicates += 1;
      continue;
    }
    let persistResult = { ok: true, duplicate: false };
    if (typeof persistInbound === 'function') {
      persistResult = (await persistInbound({
        identity: 'platform',
        phoneNumberId: msg.phoneNumberId,
        sautikitNumberId: PLATFORM_SAUTIKIT_NUMBER_ID,
        e164: PLATFORM_WHATSAPP_E164,
        contactWaId: msg.from,
        contactName: msg.contactName,
        wamid: msg.wamid,
        type: msg.type,
        body: msg.body,
        payload: msg.raw,
      })) || persistResult;
    }
    if (persistResult.duplicate) {
      duplicates += 1;
      continue;
    }
    if (typeof markRead === 'function' && msg.wamid) {
      try {
        await markRead(msg.wamid);
      } catch (err) {
        console.warn('[whatsapp] mark read failed:', err?.message || err);
      }
    }
    if (inboundAckEnabled() && typeof sendText === 'function' && msg.from) {
      try {
        await sendText({
          to: msg.from,
          type: 'text',
          body: inboundAckBody(),
        });
      } catch (err) {
        console.warn('[whatsapp] inbound ack failed:', err?.message || err);
      }
    }
    handled += 1;
  }

  for (const st of parsed.statuses) {
    const route = routePlatformWhatsApp(st.phoneNumberId);
    if (route.ignore) {
      ignored += 1;
      continue;
    }
    if (st.wamid && dedupe.remember(`status:${st.wamid}:${st.status}`)) {
      duplicates += 1;
      continue;
    }
    if (typeof persistStatus === 'function') {
      await persistStatus(st);
    }
  }

  return { handled, ignored, duplicates, calling };
}

module.exports = {
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID,
  PLATFORM_WHATSAPP_E164,
  PLATFORM_SAUTIKIT_NUMBER_ID,
  platformPhoneNumberId,
  isWhatsAppEventKind,
  isWhatsAppCallingChange,
  routePlatformWhatsApp,
  parseWhatsAppReceived,
  createWhatsAppDedupe,
  isWhatsAppSessionOpen,
  processWhatsAppReceived,
  inboundAckBody,
};
