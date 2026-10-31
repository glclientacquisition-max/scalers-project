'use strict';
// Synthetic browser-demo tenants. Staging seed only.
//
// tenants.is_demo: there is no column, and this file does not add one.
// A tenant is a demo only when its id or slug is one of the three below.
// A policies.demo flag on any other row is ignored. The Aris line is never a demo.

const fixture = require('../../fixtures/demo-tenants.json');
const { resolveBusinessType } = require('../conversation/businessType');

const ARIS_E164 = '+254709221536';
const STAGING_PROJECT_REF = 'sgcdncjxauhsbunobmob';
const PROD_PROJECT_REF = 'fjxcdccgyhnvnnlnovcl';
const PUBLIC_KEYS = Object.freeze(['home', 'shop', 'other']);
const BUSINESS_LABELS = Object.freeze({
  home_services: 'Home services',
  retail: 'Shop',
  general: 'Other business',
});

const BY_SLUG = new Map(fixture.tenants.map((row) => [row.slug, row]));
const BY_ID = new Map(fixture.tenants.map((row) => [row.id, row]));
const BY_PUBLIC = new Map(fixture.tenants.map((row) => [row.public_key, row]));

function lookup(ref) {
  const key = String(ref || '').trim();
  if (!key) return null;
  return BY_SLUG.get(key) || BY_ID.get(key) || BY_PUBLIC.get(key) || null;
}

/** True only for demo_home, demo_shop, demo_other (slug, public key, or fixed id). */
function isDemoTenant(ref) {
  if (!ref) return false;
  if (typeof ref === 'string') return Boolean(lookup(ref));
  if (typeof ref === 'object') {
    return Boolean(lookup(ref.id) || lookup(ref.slug) || lookup(ref.tenantId) || lookup(ref.tenant_id));
  }
  return false;
}

function isDemoCallSid(callSid) {
  return /^demo_/i.test(String(callSid || '').trim());
}

function demoWriteBlocked(args = {}) {
  return isDemoTenant(args.tenantId || args.tenant_id || args.id) || isDemoCallSid(args.callSid || args.call_sid);
}

function hoursText(entry) {
  return entry.business_hours;
}

function locationRow(entry) {
  const loc = entry.location || {};
  return {
    label: loc.label || 'Place',
    address: loc.address || '',
    landmark: loc.landmark || '',
    area: loc.area || '',
    directions: '',
    coverage_notes: (entry.areas || []).join(', '),
  };
}

/**
 * tenants row for one demo slug, id, or public key.
 * Phone columns are pending: placeholders, never an E.164 and never Aris.
 */
function demoTenantRow(ref) {
  const entry = lookup(ref);
  if (!entry) return null;
  const type = resolveBusinessType({
    business_type: entry.business_type,
    vertical: entry.business_type,
  });
  return {
    id: entry.id,
    business_name: entry.business_name,
    spoken_name: entry.spoken_name,
    agent_name: entry.agent_name,
    business_type: type,
    vertical: type,
    greeting_text: entry.openers.en,
    greeting_invite: entry.openers.sw,
    greeting_language: 'en',
    business_hours: hoursText(entry),
    hours_schedule: entry.hours_schedule,
    after_hours_mode: 'serve',
    services_offered: (entry.services_catalog || []).map((row) => row.name).join(', '),
    services_catalog: entry.services_catalog || [],
    product_catalog: entry.product_catalog || [],
    faqs: entry.faqs || [],
    business_locations: [locationRow(entry)],
    business_policies: {
      demo: true,
      bookings: false,
      notifications: false,
      billing: false,
      openers: entry.openers,
      call_out_fee_kes: entry.call_out_fee_kes,
      areas: entry.areas || [],
    },
    notify_channels: {
      sms: false,
      whatsapp: false,
      email: false,
      caller_sms: false,
      missed_textback: false,
      push: false,
    },
    escalation_enabled: false,
    agent_tools: { escalate: false, end_call: true },
    handoff_mode: 'callback',
    billing_enforcement: 'off',
    on_demand_usage_enabled: false,
    is_active: true,
    alert_email: null,
    sautikit_virtual_number: `pending:${entry.slug}`,
    whatsapp_notification_number: `pending:${entry.slug}`,
    team_directory: [],
    social_handles: {},
    unknown_answer_fallback: 'I do not have that on file.',
  };
}

function demoTenantProfile(ref) {
  const row = demoTenantRow(ref);
  if (!row) return null;
  const { tenantProfileFromRow } = require('../tenantProfile');
  return tenantProfileFromRow(row);
}

function resolveDemoTenant(ref) {
  const entry = lookup(ref);
  if (!entry) return null;
  const row = demoTenantRow(entry.slug);
  const businessType = resolveBusinessType({
    business_type: row.business_type,
    vertical: row.vertical,
  });
  return {
    slug: entry.slug,
    id: entry.id,
    publicKey: entry.public_key,
    businessType,
    label: BUSINESS_LABELS[businessType],
    row,
    profile: demoTenantProfile(entry.slug),
  };
}

function listDemoTenants() {
  return PUBLIC_KEYS.map((key) => resolveDemoTenant(key));
}

function seedRows() {
  return listDemoTenants().map((item) => item.row);
}

function assertPayloadSafe(rows) {
  const blob = JSON.stringify(rows);
  if (blob.includes(ARIS_E164) || blob.includes('254709221536')) {
    throw new Error('refusing: demo payload mentions the Aris line');
  }
  for (const row of rows) {
    if (!isDemoTenant(row.id)) throw new Error('refusing: row is not a demo tenant');
    const did = String(row.sautikit_virtual_number || '');
    const wa = String(row.whatsapp_notification_number || '');
    if (!did.startsWith('pending:demo_') || !wa.startsWith('pending:demo_')) {
      throw new Error('refusing: demo phone columns must be pending placeholders');
    }
    if (/\+\d{6,}/.test(did) || /\+\d{6,}/.test(wa)) {
      throw new Error('refusing: demo row has an E.164 number');
    }
  }
  return rows;
}

/**
 * The seed may run only when Railway says staging and the URL is the staging project.
 * Exact value `staging`. Prod ref is refused even if the Railway name is wrong.
 */
function assertSeedTarget({ railwayEnvironment, supabaseUrl } = {}) {
  const railway = String(railwayEnvironment || '');
  const url = String(supabaseUrl || '');
  if (railway !== 'staging') {
    return {
      ok: false,
      reason: 'refusing: RAILWAY_ENVIRONMENT must be the exact value staging',
    };
  }
  if (url.includes(PROD_PROJECT_REF)) {
    return { ok: false, reason: 'refusing: SUPABASE_URL is the prod project' };
  }
  if (!url.includes(STAGING_PROJECT_REF)) {
    return { ok: false, reason: 'refusing: SUPABASE_URL is not the staging project' };
  }
  return { ok: true, reason: 'ok' };
}

/** A delete is allowed only for a demo id whose stored number is still the placeholder. */
function assertRemovable(row) {
  if (!row || !isDemoTenant(row.id)) return { ok: false, reason: 'not_demo' };
  const did = String(row.sautikit_virtual_number || '');
  if (did === ARIS_E164 || did.includes('254709221536')) {
    return { ok: false, reason: 'aris' };
  }
  if (!did.startsWith('pending:demo_')) return { ok: false, reason: 'not_placeholder' };
  return { ok: true, reason: 'ok' };
}

function demoBookingSink(kind, args = {}) {
  return {
    id: null,
    sink: 'demo',
    kind: kind || 'appointment',
    external: false,
    notified: false,
    billed: false,
    status: 'skipped',
    tenantId: args.tenantId || args.tenant_id || null,
  };
}

/** Demo calls are never debited, even if a caller passes enforcement on. */
function quoteDemoBilling(tenantRef, input = {}) {
  if (!isDemoTenant(tenantRef)) return null;
  const { quoteCallOverage } = require('../billing/packageOverage');
  const quote = quoteCallOverage({
    ...input,
    enforcement: 'off',
    onDemand: false,
  });
  return { ...quote, debitKes: 0, reason: 'demo', charge: false };
}

function applyDemoCapabilities(capabilities, profile) {
  if (!isDemoTenant(profile?.id || profile?.tenantId || profile)) return capabilities;
  return {
    ...capabilities,
    createServiceRequest: false,
    placeHold: false,
    confirmVisit: false,
    confirmedSlot: false,
    createAppointment: false,
    updateAppointment: false,
    notifyCallback: false,
    escalate: false,
    liveTransfer: false,
  };
}

module.exports = {
  ARIS_E164,
  STAGING_PROJECT_REF,
  PROD_PROJECT_REF,
  PUBLIC_KEYS,
  BUSINESS_LABELS,
  fixture,
  isDemoTenant,
  isDemoCallSid,
  demoWriteBlocked,
  demoTenantRow,
  demoTenantProfile,
  resolveDemoTenant,
  listDemoTenants,
  seedRows,
  assertPayloadSafe,
  assertSeedTarget,
  assertRemovable,
  demoBookingSink,
  quoteDemoBilling,
  applyDemoCapabilities,
};
