// src/notifications/whatsapp.js
// Owner / platform WhatsApp via SautiKit Messaging API.
// Phase 0 dual-use: sender is always the Scalers platform number
// (SautiKit 81424fbd-8f4c-459a-858d-98ced4393df6 / +254709221536).
// Voice on that DID still belongs to Done and Dusted until Phase 2.
// Do not send shop-caller chat from this number. Do not enable Calling.
// Staff originate: Meta utility templates (docs/WHATSAPP_TEMPLATES.md).
// Session text only inside an open 24h window (inbound ack, or a follow-up ping).

const SAUTIKIT_API_BASE = process.env.SAUTIKIT_API_BASE || 'https://api.sautikit.com';
const { isWhatsAppSessionOpen, normalizeWhatsAppContactId } = require('../sautikit/whatsappInbound');
const {
  APPROVED_FIRST_TEMPLATE,
  APPROVED_FIRST_TEMPLATE_LANG,
  bodyComponentsFromParameters,
  buildStaffWhatsAppTemplate,
  genericTemplateName,
  templateLanguage,
} = require('./whatsappTemplates');

function isWhatsAppConfigured() {
  return Boolean(
    process.env.SAUTIKIT_API_KEY &&
      (process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || process.env.SAUTIKIT_WHATSAPP_CONNECTION_ID)
  );
}

/** Cloud API `to` / thread key: digits with country code, no leading +. */
function normalizeWhatsAppTo(phone) {
  return normalizeWhatsAppContactId(phone);
}

function platformWhatsAppSender() {
  const numberId = String(process.env.SAUTIKIT_WHATSAPP_NUMBER_ID || '').trim();
  const connectionId = String(process.env.SAUTIKIT_WHATSAPP_CONNECTION_ID || '').trim();
  return {
    number_id: numberId || null,
    connection_id: numberId ? null : connectionId || null,
  };
}

function senderFields() {
  const sender = platformWhatsAppSender();
  if (sender.number_id) return { number_id: sender.number_id };
  if (sender.connection_id) return { connection_id: sender.connection_id };
  throw new Error('Set SAUTIKIT_WHATSAPP_NUMBER_ID or SAUTIKIT_WHATSAPP_CONNECTION_ID');
}

function buildLeadText({ businessName, name, reason, callerNumber, recordingUrl }) {
  const lines = [
    `New missed-call lead${businessName ? `. ${businessName}` : ''}`,
    `Name: ${name || 'Caller'}`,
    `Phone: ${callerNumber || '.'}`,
    `Reason: ${reason || 'Missed call'}`,
  ];
  if (recordingUrl) lines.push(`Recording: ${recordingUrl}`);
  return lines.join('\n');
}

function buildWhatsAppTemplatePayload({
  to,
  templateName,
  language,
  components,
  parameters,
  kind,
  body,
  lead = {},
} = {}) {
  const toNorm = normalizeWhatsAppTo(to);
  if (!toNorm) throw new Error('WhatsApp destination number is empty');

  const built = buildStaffWhatsAppTemplate({
    kind,
    body: body || buildLeadText(lead),
    lead,
    to: toNorm,
    templateName: templateName || undefined,
    language: language || undefined,
  });
  const name = templateName || built.name || genericTemplateName();
  const language_code = language || built.language_code || templateLanguage();
  const resolvedComponents =
    Array.isArray(components) && components.length
      ? components
      : bodyComponentsFromParameters(parameters || built.parameters);

  return {
    ...senderFields(),
    to: toNorm,
    type: 'template',
    template: {
      name,
      language_code,
      components: resolvedComponents,
    },
  };
}

function buildWhatsAppSendPayload({
  to,
  body,
  lead = {},
  windowOpen = false,
  kind,
  templateName,
  language,
  components,
} = {}) {
  const toNorm = normalizeWhatsAppTo(to);
  if (!toNorm) throw new Error('WhatsApp destination number is empty');

  if (windowOpen) {
    return {
      ...senderFields(),
      to: toNorm,
      type: 'text',
      text: {
        body: body || buildLeadText(lead),
        preview_url: Boolean(lead.recordingUrl),
      },
    };
  }

  return buildWhatsAppTemplatePayload({
    to,
    templateName,
    language,
    components,
    kind,
    body,
    lead,
  });
}

function mapWhatsAppSendError(status, json, text) {
  const errObj = json && typeof json === 'object' ? json.error || json : {};
  const code = errObj.code || errObj.error_code || json?.code || status;
  const message = String(errObj.message || errObj.error_user_msg || text || '').slice(0, 300);
  let reason = 'send_failed';
  if (status === 401 || status === 403) reason = 'auth';
  else if (status >= 500) reason = 'upstream';
  else if (code === 131047 || /24\s*hour|session window/i.test(message)) reason = 'outside_24h_window';
  else if (code === 132001 || /template.*(not (exist|found)|name)/i.test(message)) {
    reason = 'template_not_found';
  } else if (code === 132000 || /parameter/i.test(message)) reason = 'template_param_mismatch';
  else if (code === 131026 || /not a whatsapp/i.test(message)) reason = 'not_whatsapp_user';
  else if (code === 131042 || /currency is not configured|payment issue/i.test(message)) {
    reason = 'whatsapp_billing';
  }
  return { status, code, reason, message };
}

function whatsAppMessageId(json) {
  if (!json || typeof json !== 'object') return null;
  const messages = json.messages || json.data?.messages;
  if (Array.isArray(messages) && messages[0]) {
    const nested = messages[0].id || messages[0].message_id || messages[0].wamid;
    if (nested) return String(nested);
  }
  const id = json.wamid || json.message_id || json.messageId || json.id;
  return id ? String(id) : null;
}

function sautikitSendLooksFailed(status, json) {
  if (status !== 200 && status !== 202) return true;
  if (!json || typeof json !== 'object') return false;
  if (json.error || json.errors) return true;
  if (json.ok === false) return true;
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sautikitTransient(status, err) {
  const code = Number(status || err?.status);
  return code === 502 || code === 503 || code === 504 || err?.reason === 'upstream';
}

async function postWhatsAppMessage(payload, { tries = 3 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt += 1) {
    try {
      const { status, json, text } = await sautikitWhatsAppPost('/v1/whatsapp/messages', payload);
      if (sautikitSendLooksFailed(status, json)) {
        if (sautikitTransient(status) && attempt < tries) {
          console.warn(`[whatsapp] send ${status} upstream; retry ${attempt}/${tries}`);
          await sleep(250 * attempt);
          continue;
        }
        throwWhatsAppSendError(status, json, text);
      }
      const messageId = whatsAppMessageId(json);
      console.log(
        '[whatsapp] send accepted',
        JSON.stringify({
          to: payload.to,
          type: payload.type,
          template: payload.template?.name || null,
          language: payload.template?.language_code || null,
          status,
          messageId,
        })
      );
      return json && typeof json === 'object' ? { ...json, messageId } : { messageId, raw: json };
    } catch (err) {
      lastErr = err;
      if (!sautikitTransient(err.status, err) || attempt >= tries) throw err;
      console.warn(`[whatsapp] send failed (${err.reason || err.status}); retry ${attempt}/${tries}`);
      await sleep(250 * attempt);
    }
  }
  throw lastErr;
}

function templateSendRetryable(err) {
  const reason = String(err?.reason || '');
  const message = String(err?.message || '');
  return (
    reason === 'template_not_found' ||
    reason === 'template_param_mismatch' ||
    /language|translation|template/i.test(message)
  );
}

async function sendTemplateWithFallback(opts = {}) {
  const first = buildWhatsAppTemplatePayload(opts);
  const attempts = [first];
  const seen = new Set([`${first.template.name}:${first.template.language_code}`]);
  for (const language of [APPROVED_FIRST_TEMPLATE_LANG, 'en_US', 'en']) {
    const next = buildWhatsAppTemplatePayload({
      ...opts,
      templateName: APPROVED_FIRST_TEMPLATE,
      language,
    });
    const key = `${next.template.name}:${next.template.language_code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attempts.push(next);
  }
  let lastErr;
  for (const payload of attempts) {
    try {
      return await postWhatsAppMessage(payload);
    } catch (err) {
      lastErr = err;
      if (!templateSendRetryable(err)) throw err;
      console.warn(
        `[whatsapp] template send failed (${err.reason || err.message}); retrying approved first template`
      );
    }
  }
  throw lastErr;
}

function throwWhatsAppSendError(status, json, text) {
  const mapped = mapWhatsAppSendError(status, json, text);
  const err = new Error(`SautiKit WhatsApp send failed: ${mapped.status} ${mapped.reason} ${mapped.message}`);
  err.status = mapped.status;
  err.code = mapped.code;
  err.reason = mapped.reason;
  err.body = json;
  throw err;
}

async function sautikitWhatsAppPost(path, payload) {
  const apiKey = process.env.SAUTIKIT_API_KEY;
  if (!apiKey) throw new Error('SAUTIKIT_API_KEY is not configured');
  const res = await fetch(`${SAUTIKIT_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

/**
 * Send a WhatsApp message through SautiKit from the Scalers platform number.
 * Closed 24h window: utility template. Open window: session text.
 */
async function sendOwnerWhatsApp({
  to,
  body,
  lead = {},
  kind,
  windowOpen,
  lastInboundAt,
} = {}) {
  let open = windowOpen === true;
  if (windowOpen !== true && windowOpen !== false) {
    if (lastInboundAt) {
      open = isWhatsAppSessionOpen(lastInboundAt, new Date());
    } else if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const db = require('../db');
        const session = await db.getWhatsAppSession({
          phoneNumberId:
            process.env.SAUTIKIT_WHATSAPP_PHONE_NUMBER_ID ||
            process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID ||
            '1237105982825100',
          contactWaId: normalizeWhatsAppTo(to),
        });
        open = isWhatsAppSessionOpen(session?.last_inbound_at, new Date());
      } catch {
        open = false;
      }
    }
  }
  const payload = buildWhatsAppSendPayload({ to, body, lead, windowOpen: open, kind });
  if (open) {
    return postWhatsAppMessage(payload);
  }
  return sendTemplateWithFallback({ to, body, lead, kind });
}

/**
 * Always send a Cloud API template (never session text).
 * Default name/language: approved first template `scalers_staff_alert` / `en_US`.
 */
async function sendWhatsAppTemplate({
  to,
  templateName,
  language,
  components,
  parameters,
  kind,
  body,
  lead = {},
  dryRun = false,
} = {}) {
  const payload = buildWhatsAppTemplatePayload({
    to,
    templateName: templateName || genericTemplateName(),
    language: language || templateLanguage(),
    components,
    parameters,
    kind,
    body,
    lead,
  });
  if (dryRun) return { dryRun: true, payload };
  return sendTemplateWithFallback({
    to,
    templateName: payload.template.name,
    language: payload.template.language_code,
    components: payload.template.components,
    kind,
    body,
    lead,
  });
}

async function markWhatsAppRead(wamid) {
  const id = String(wamid || '').trim();
  if (!id) return { ok: false, reason: 'no_wamid' };
  const { status, json } = await sautikitWhatsAppPost(
    `/v1/whatsapp/messages/${encodeURIComponent(id)}/read`,
    {}
  );
  if (status !== 202 && status !== 200) {
    const err = new Error(`SautiKit WhatsApp read failed: ${status}`);
    err.status = status;
    err.body = json;
    throw err;
  }
  return json || { ok: true };
}

module.exports = {
  isWhatsAppConfigured,
  whatsAppMessageId,
  normalizeWhatsAppTo,
  buildLeadText,
  platformWhatsAppSender,
  buildWhatsAppSendPayload,
  buildWhatsAppTemplatePayload,
  mapWhatsAppSendError,
  sendOwnerWhatsApp,
  sendWhatsAppTemplate,
  markWhatsAppRead,
};
