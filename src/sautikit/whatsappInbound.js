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

/**
 * Map inbound `from` / `wa_id` to Cloud API digits (no +).
 * Kenya 07… and 7… become 2547…. Non-Kenya digits stay as given.
 */
function normalizeWhatsAppContactId(raw) {
  let digits = String(raw || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if (/^[17]\d{8}$/.test(digits)) {
    digits = `254${digits}`;
  }
  return digits;
}

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

function isWhatsAppValueObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.messaging_product === 'whatsapp') return true;
  if (value.metadata && typeof value.metadata === 'object') return true;
  if (Array.isArray(value.messages) || Array.isArray(value.statuses)) return true;
  if (Array.isArray(value.calls) || Array.isArray(value.contacts)) return true;
  return false;
}

function collectWhatsAppValue(value, inbound, statuses, calling) {
  if (!isWhatsAppValueObject(value)) return;
  if (Array.isArray(value.calls) && value.calls.length) {
    calling.push({ field: 'calls', value });
    return;
  }
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

function mergeParsedWhatsApp(target, extra) {
  if (!extra) return target;
  target.inbound.push(...(extra.inbound || []));
  target.statuses.push(...(extra.statuses || []));
  target.calling.push(...(extra.calling || []));
  return target;
}

/**
 * SautiKit workspace webhooks wrap events as `{ kind, event_id, data }`.
 * `data` is Meta's `value` object (no Graph `entry`) or a full Graph envelope.
 */
function parseWhatsAppReceived(body, _depth = 0) {
  const inbound = [];
  const statuses = [];
  const calling = [];
  if (!body || typeof body !== 'object' || _depth > 3) {
    return { inbound, statuses, calling };
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      if (isWhatsAppCallingChange(change)) {
        calling.push(change);
        continue;
      }
      collectWhatsAppValue(change?.value || {}, inbound, statuses, calling);
    }
  }

  if (!inbound.length && !statuses.length && !calling.length) {
    if (isWhatsAppValueObject(body.value)) {
      if (isWhatsAppCallingChange({ field: 'calls', value: body.value })) {
        calling.push({ field: 'calls', value: body.value });
      } else {
        collectWhatsAppValue(body.value, inbound, statuses, calling);
      }
    } else if (isWhatsAppValueObject(body)) {
      collectWhatsAppValue(body, inbound, statuses, calling);
    }
  }

  if (!inbound.length && !statuses.length && !calling.length) {
    for (const nested of [body.data, body.payload]) {
      if (nested && typeof nested === 'object' && nested !== body) {
        mergeParsedWhatsApp(
          { inbound, statuses, calling },
          parseWhatsAppReceived(nested, _depth + 1)
        );
        if (inbound.length || statuses.length || calling.length) break;
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
        contactWaId: normalizeWhatsAppContactId(msg.from),
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
    const contactId = normalizeWhatsAppContactId(msg.from);
    if (inboundAckEnabled() && typeof sendText === 'function' && contactId) {
      try {
        await sendText({
          to: contactId,
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
    const errors = Array.isArray(st.raw?.errors) ? st.raw.errors : [];
    const first = errors[0] || {};
    console.warn(
      '[whatsapp] delivery',
      JSON.stringify({
        status: st.status || null,
        recipient: st.recipientId || null,
        code: first.code || null,
        title: first.title || null,
        detail: first.error_data?.details || first.message || null,
      })
    );
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
  normalizeWhatsAppContactId,
};
