// Meta utility templates for staff WhatsApp.
// Catalog to submit: docs/WHATSAPP_TEMPLATES.md
// Session text is not used. Params are never empty. No URLs. No em dashes.

const PARAM_MAX = 500;

const KIND_ENV = Object.freeze({
  lead: 'SAUTIKIT_WHATSAPP_TEMPLATE_LEAD',
  escalation: 'SAUTIKIT_WHATSAPP_TEMPLATE_ESCALATION',
  appointment: 'SAUTIKIT_WHATSAPP_TEMPLATE_APPOINTMENT',
  service_request: 'SAUTIKIT_WHATSAPP_TEMPLATE_SERVICE_REQUEST',
  wallet_low: 'SAUTIKIT_WHATSAPP_TEMPLATE_WALLET',
  wallet_empty: 'SAUTIKIT_WHATSAPP_TEMPLATE_WALLET',
  outage_speech: 'SAUTIKIT_WHATSAPP_TEMPLATE_OUTAGE',
  outage_llm: 'SAUTIKIT_WHATSAPP_TEMPLATE_OUTAGE',
});

const KIND_DEFAULT_NAME = Object.freeze({
  lead: 'scalers_lead',
  escalation: 'scalers_escalation',
  appointment: 'scalers_visit',
  service_request: 'scalers_request',
  wallet_low: 'scalers_wallet',
  wallet_empty: 'scalers_wallet',
  outage_speech: 'scalers_outage',
  outage_llm: 'scalers_outage',
});

/** First Meta-approved Utility on the Scalers WABA. Unblocks every staff event. */
const APPROVED_FIRST_TEMPLATE = 'scalers_staff_alert';
const APPROVED_FIRST_TEMPLATE_LANG = 'en_US';
const GENERIC_DEFAULT_NAME = APPROVED_FIRST_TEMPLATE;
const LEGACY_GENERIC_NAMES = Object.freeze(['missed_call_lead']);

function envTrim(name) {
  const raw = process.env[name];
  return raw && String(raw).trim() ? String(raw).trim() : '';
}

function allowLegacyGeneric() {
  return /^(1|true|on|yes)$/i.test(
    String(process.env.SAUTIKIT_WHATSAPP_TEMPLATE_ALLOW_LEGACY || '').trim()
  );
}

function templateLanguage() {
  return envTrim('SAUTIKIT_WHATSAPP_TEMPLATE_LANG') || APPROVED_FIRST_TEMPLATE_LANG;
}

function genericTemplateName() {
  const envName = envTrim('SAUTIKIT_WHATSAPP_TEMPLATE');
  if (!envName) return APPROVED_FIRST_TEMPLATE;
  if (!allowLegacyGeneric() && LEGACY_GENERIC_NAMES.includes(envName)) {
    return APPROVED_FIRST_TEMPLATE;
  }
  return envName;
}

function templateNameForKind(kind) {
  const key = KIND_ENV[kind];
  if (key) {
    const specific = envTrim(key);
    if (specific) return specific;
  }
  return genericTemplateName();
}

function isApprovedFirstTemplate(name) {
  return String(name || '') === APPROVED_FIRST_TEMPLATE;
}

function usesCatalogLayout(name) {
  return String(name || '').startsWith('scalers_');
}

function sanitizeParam(value, fallback = '.') {
  let text = String(value == null ? '' : value)
    .replace(/[—–]/g, ', ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) text = fallback;
  if (text.length > PARAM_MAX) text = `${text.slice(0, PARAM_MAX - 3).trim()}...`;
  return text;
}

function staffBodyLines(body) {
  return String(body || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(Recording|Open call):/i.test(line));
}

function splitTitleBusiness(firstLine, lead = {}) {
  const raw = String(firstLine || '').trim();
  const idx = raw.indexOf('. ');
  if (idx > 0) {
    return {
      title: raw.slice(0, idx).trim(),
      business: raw.slice(idx + 2).trim() || lead.businessName || 'Scalers',
    };
  }
  return {
    title: raw || 'Scalers alert',
    business: String(lead.businessName || '').trim() || 'Scalers',
  };
}

function whoPhone(lead = {}) {
  const name = String(lead.name || '').trim() || 'Caller';
  const phone = String(lead.callerNumber || lead.phone || '').trim();
  return phone ? `${name}. ${phone}` : name;
}

function packGeneric(body, lead = {}) {
  const lines = staffBodyLines(body);
  const p1 = lines[0] || lead.reason || 'Scalers alert';
  const rest = lines.slice(1);
  const p2 = rest[0] || whoPhone(lead);
  const p3 = rest.slice(1).join('. ') || lead.reason || 'Open the desk to act.';
  return [p1, p2, p3];
}

function packLead(body, lead = {}) {
  const business = String(lead.businessName || '').trim() || 'Scalers';
  const name = String(lead.name || '').trim() || 'Caller';
  const phone = String(lead.callerNumber || lead.phone || '').trim() || '.';
  const reason = String(lead.reason || '').trim() || 'Missed call';
  return [business, `Name: ${name}. Phone: ${phone}`, `Reason: ${reason}`];
}

function packEscalation(body, lead = {}) {
  const lines = staffBodyLines(body);
  const { title, business } = splitTitleBusiness(lines[0], lead);
  const teammate = title.replace(/^Escalation for\s+/i, '').trim() || 'the team';
  const name = String(lead.name || '').trim() || 'Caller';
  const phone = String(lead.callerNumber || lead.phone || '').trim() || 'Unknown';
  const reason = String(lead.reason || '').trim() || 'None';
  return [teammate, business, `Caller: ${name}. Phone: ${phone}. Reason: ${reason}`];
}

function packTitled(body, lead = {}) {
  const lines = staffBodyLines(body);
  const { title, business } = splitTitleBusiness(lines[0], lead);
  const detail =
    lines.slice(1).join('. ') || String(lead.reason || '').trim() || 'Open the desk to act.';
  return [title, business, detail];
}

function packOutage(body, lead = {}) {
  const lines = staffBodyLines(body);
  const joined = lines.join(' ').trim();
  const parts = joined
    .split(/(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const p1 = parts[0] || lead.reason || 'Scalers line downtime.';
  const p2 = parts.slice(1).join(' ') || 'Callers were asked to call back.';
  return [p1, p2, 'Open the desk to act.'];
}

function packLegacyLeadFields(lead = {}, toFallback = '') {
  return [
    String(lead.name || '').trim() || 'Caller',
    String(lead.callerNumber || lead.phone || toFallback || '').trim() || '.',
    String(lead.reason || '').trim() || 'Missed call',
  ];
}

function parametersForKind(kind, { body, lead = {}, to, templateName } = {}) {
  const name = templateName || templateNameForKind(kind);
  if (!usesCatalogLayout(name)) {
    return packLegacyLeadFields(lead, to).map((value) => sanitizeParam(value));
  }
  if (isApprovedFirstTemplate(name)) {
    return packGeneric(body, lead).map((value) => sanitizeParam(value));
  }
  let raw;
  switch (kind) {
    case 'lead':
      raw = packLead(body, lead);
      break;
    case 'escalation':
      raw = packEscalation(body, lead);
      break;
    case 'appointment':
    case 'service_request':
    case 'wallet_low':
    case 'wallet_empty':
      raw = packTitled(body, lead);
      break;
    case 'outage_speech':
    case 'outage_llm':
      raw = packOutage(body, lead);
      break;
    default:
      raw = packGeneric(body, lead);
  }
  return raw.map((value) => sanitizeParam(value));
}

function buildStaffWhatsAppTemplate({
  kind,
  body,
  lead = {},
  to,
  templateName,
  language,
} = {}) {
  const name = templateName || templateNameForKind(kind);
  const parameters = parametersForKind(kind, { body, lead, to, templateName: name });
  return {
    name,
    language_code: language || templateLanguage(),
    parameters,
  };
}

function bodyComponentsFromParameters(parameters) {
  return [
    {
      type: 'body',
      parameters: (parameters || []).map((text) => ({ type: 'text', text })),
    },
  ];
}

module.exports = {
  APPROVED_FIRST_TEMPLATE,
  APPROVED_FIRST_TEMPLATE_LANG,
  GENERIC_DEFAULT_NAME,
  KIND_DEFAULT_NAME,
  LEGACY_GENERIC_NAMES,
  bodyComponentsFromParameters,
  buildStaffWhatsAppTemplate,
  genericTemplateName,
  isApprovedFirstTemplate,
  parametersForKind,
  sanitizeParam,
  templateLanguage,
  templateNameForKind,
  usesCatalogLayout,
};
