'use strict';
// Typed tool catalogue (JSON Schema, additionalProperties:false) + a small validator.
// Server fills tenant_id / contact_id / call_id; the model never supplies them.
// Enums are built per turn from the tenant catalogue and the caller's OWN open rows.

function buildCatalogue({ profile = {}, openRows = [] } = {}) {
  let serviceIds = (profile.servicesCatalog || []).map((s) => s.id).filter(Boolean);
  let productIds = (profile.productCatalog || []).map((p, i) => p.id || `prd_${i}`);
  // R7a: when the owner catalogue has no row ids (staging DnD), use fact-store ids so
  // validateCall can accept get_price / check_availability proposals (same ids modelShadow uses).
  try {
    const FS = require('../../knowledge/factStore');
    if (FS.factStoreEnabled()) {
      const facts = FS.factsFor(profile || {});
      if (!serviceIds.length) serviceIds = (facts.services || []).map((s) => s.id).filter(Boolean);
      if (!(profile.productCatalog || []).some((p) => p && p.id)) {
        const fromFacts = (facts.products || []).map((p) => p.id).filter(Boolean);
        if (fromFacts.length) productIds = fromFacts;
      }
    }
  } catch { /* keep catalogue enums */ }
  const rowIds = openRows.map((r) => r.id);
  const when = { type: 'object', additionalProperties: false, properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' }, raw: { type: 'string', maxLength: 80 } } };
  const token = { type: 'string', pattern: '^ct_[a-z0-9]+$' };
  const enumOrNone = (xs) => (xs.length ? { type: 'string', enum: xs } : { type: 'string', enum: ['__none__'] });
  const T = {
    create_booking: { description: 'Book a visit. Call once to propose (returns a read-back); commit only with the confirm_token from the caller\'s yes.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['service_id'], properties: { service_id: enumOrNone(serviceIds), when, place: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', maxLength: 80 } } }, notes: { type: 'string', maxLength: 200 }, confirm_token: token } } },
    update_booking: { description: 'Move one of the caller\'s own open bookings.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['booking_id'], properties: { booking_id: enumOrNone(rowIds), when, confirm_token: token } } },
    cancel_booking: { description: 'Cancel one of the caller\'s own open bookings.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['booking_id'], properties: { booking_id: enumOrNone(rowIds), reason: { type: 'string', maxLength: 120 }, confirm_token: token } } },
    create_order: { description: 'Save a pickup order from catalogue products.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['items'], properties: { items: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['product_id', 'qty'], properties: { product_id: enumOrNone(productIds), qty: { type: 'integer', minimum: 1, maximum: 999 } } } }, pickup_when: when, confirm_token: token } } },
    check_availability: { description: 'Look up whether a service/product is offered or in stock, or whether an area is served. The only source for availability speech.', mutating: false,
      parameters: { type: 'object', additionalProperties: false, properties: { service_id: enumOrNone(serviceIds), product_id: enumOrNone(productIds), area: { type: 'string', maxLength: 60 }, query: { type: 'string', maxLength: 80 }, date: { type: 'string' } } } },
    get_price: { description: 'Look up a catalogue price.', mutating: false,
      parameters: { type: 'object', additionalProperties: false, properties: { service_id: enumOrNone(serviceIds), product_id: enumOrNone(productIds), query: { type: 'string', maxLength: 80 } } } },
    get_hours: { description: 'Opening hours from the tenant schedule.', mutating: false,
      parameters: { type: 'object', additionalProperties: false, properties: { day: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'today', 'week'] } } } },
    log_complaint: { description: 'Record a complaint as an owner task.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['category', 'summary'], properties: { category: { type: 'string', enum: ['service_quality', 'damage', 'staff', 'billing', 'other'] }, summary: { type: 'string', maxLength: 200 }, severity: { type: 'string', enum: ['low', 'medium', 'high'] } } } },
    create_handoff: { description: 'Owner callback with captured slots. Address and payment changes go here only.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', enum: ['callback', 'owner_only_change', 'complaint', 'unknown'] }, captured: { type: 'object' }, confirm_token: token } } },
    save_caller_name: { description: 'Save the caller\'s confirmed name.', mutating: true,
      parameters: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', minLength: 2, maxLength: 60 } } } },
    lookup_file: { description: 'Read the caller\'s own file.', mutating: false,
      parameters: { type: 'object', additionalProperties: false, required: ['topic'], properties: { topic: { type: 'string', enum: ['open_tasks', 'last_visit', 'orders'] } } } },
  };
  return T;
}

function validate(schema, value, path = '$') {
  const errs = [];
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${path}: expected object`];
    for (const k of schema.required || []) if (value[k] == null) errs.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      const ps = schema.properties?.[k];
      if (!ps) { if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`); continue; }
      errs.push(...validate(ps, v, `${path}.${k}`));
    }
  } else if (t === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`];
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: too few`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: too many`);
    value.forEach((x, i) => errs.push(...validate(schema.items, x, `${path}[${i}]`)));
  } else if (t === 'string') {
    if (typeof value !== 'string') return [`${path}: expected string`];
    if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not in enum`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: pattern`);
    if (schema.maxLength != null && value.length > schema.maxLength) errs.push(`${path}: too long`);
    if (schema.minLength != null && value.length < schema.minLength) errs.push(`${path}: too short`);
  } else if (t === 'integer') {
    if (!Number.isInteger(value)) return [`${path}: expected integer`];
    if (schema.minimum != null && value < schema.minimum) errs.push(`${path}: below minimum`);
    if (schema.maximum != null && value > schema.maximum) errs.push(`${path}: above maximum`);
  }
  return errs;
}

function validateCall(catalogue, call) {
  const def = catalogue[call?.name];
  if (!def) return { ok: false, code: 'unknown_tool', errors: [`unknown tool ${call?.name}`] };
  const errors = validate(def.parameters, call.args || {});
  return errors.length ? { ok: false, code: 'schema_invalid', errors } : { ok: true };
}

// Gemini wire format: tools[].functionDeclarations (OpenAPI subset: drop additionalProperties/pattern-free).
function toFunctionDeclarations(catalogue, names) {
  const strip = (s) => {
    if (!s || typeof s !== 'object') return s;
    const o = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === 'additionalProperties' || k === 'pattern') continue;
      o[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, strip(pv)])) : (typeof v === 'object' && !Array.isArray(v) ? strip(v) : v);
    }
    if (o.type) o.type = String(o.type).toUpperCase();
    return o;
  };
  return Object.entries(catalogue).filter(([n]) => !names || names.includes(n)).map(([name, d]) => ({ name, description: d.description, parameters: strip(d.parameters) }));
}
module.exports = { buildCatalogue, validate, validateCall, toFunctionDeclarations };
