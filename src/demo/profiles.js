'use strict';

// Voice-side copy of the three synthetic tenants from draft PR #1089
// (fixtures/demo-tenants.json on desk/demo-tenants-seed).
// Ids, slugs, and openers match that fixture. There is no DID.
// A database row is used only when its id is one of these and policies.demo is true.
// Anything else, including a missing row that falls back to BUSINESS_NAME, is ignored.

const TENANTS = Object.freeze([
  {
    slug: 'demo_home',
    publicKey: 'home',
    id: '11111111-1111-4111-8111-111111111101',
    businessName: 'Amani Visit Services',
    spokenName: 'Amani Visit Services',
    agentName: 'Amina',
    businessType: 'home_services',
    openers: {
      en: 'Amani Visit Services, Amina speaking. We clean homes and fix small leaks around Kilimani.',
      sw: 'Amani Visit Services, Amina hapa. Tunasafisha nyumba na kurekebisha mabomba madogo karibu na Kilimani.',
    },
  },
  {
    slug: 'demo_shop',
    publicKey: 'shop',
    id: '11111111-1111-4111-8111-111111111102',
    businessName: 'Nuru Lane Electronics',
    spokenName: 'Nuru Lane Electronics',
    agentName: 'Neema',
    businessType: 'retail',
    openers: {
      en: 'Nuru Lane Electronics, Neema speaking. Ask a price and I will read it from the shelf list.',
      sw: 'Nuru Lane Electronics, Neema hapa. Uliza bei nami nitasoma kutoka kwenye orodha ya rafu.',
    },
  },
  {
    slug: 'demo_other',
    publicKey: 'other',
    id: '11111111-1111-4111-8111-111111111103',
    businessName: 'Pendo Office Help',
    spokenName: 'Pendo Office Help',
    agentName: 'Pendo',
    businessType: 'general',
    openers: {
      en: 'Pendo Office Help. I can tell you our hours and take a message.',
      sw: 'Pendo Office Help. Naweza kukuambia saa zetu na kuchukua ujumbe.',
    },
  },
]);

const BY_SLUG = new Map(TENANTS.map((row) => [row.slug, row]));
const BY_ID = new Map(TENANTS.map((row) => [row.id, row]));
const DEMO_TENANT_UUIDS = new Set(TENANTS.map((row) => row.id));

function demoTenant(ref) {
  const key = String(ref || '').trim();
  return BY_SLUG.get(key) || BY_ID.get(key) || null;
}

function isDemoTenantUuid(id) {
  return DEMO_TENANT_UUIDS.has(String(id || ''));
}

/** Profile the demo brain may see. Phone columns are absent on purpose. */
function fixtureProfile(ref) {
  const row = demoTenant(ref);
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.id,
    slug: row.slug,
    publicKey: row.publicKey,
    businessName: row.businessName,
    spokenName: row.spokenName,
    agentName: row.agentName,
    business_name: row.businessName,
    spoken_name: row.spokenName,
    agent_name: row.agentName,
    businessType: row.businessType,
    vertical: row.businessType,
    greetingText: row.openers.en,
    greetingInvite: row.openers.sw,
    greetingLanguage: 'en',
    openers: { en: row.openers.en, sw: row.openers.sw },
    servicesCatalog: [],
    productCatalog: [],
    businessPolicies: {
      demo: true,
      bookings: false,
      notifications: false,
      billing: false,
      openers: { en: row.openers.en, sw: row.openers.sw },
    },
    notifyChannels: {
      sms: false,
      whatsapp: false,
      email: false,
      caller_sms: false,
      missed_textback: false,
      push: false,
    },
    agentTools: { escalate: false, end_call: true },
    escalation_enabled: false,
    handoffMode: 'callback',
    billingEnforcement: 'off',
  };
}

function policiesOf(row) {
  return row?.businessPolicies || row?.business_policies || {};
}

/**
 * Accept a stored profile only when it is one of the three demo uuids and
 * marked demo. Never a callSid lookup, never a DID, never the env-name fallback.
 */
function acceptStoredProfile(stored, local) {
  if (!stored || !local) return null;
  const id = stored.id || stored.tenantId || stored.tenant_id;
  if (id !== local.id || !isDemoTenantUuid(id)) return null;
  if (policiesOf(stored).demo !== true) return null;
  return stored;
}

function openerFor(profile, lang) {
  const which = lang === 'sw' ? 'sw' : 'en';
  const fromFixture = profile?.openers?.[which];
  if (which === 'sw') {
    const stored = profile?.greetingInvite;
    if (typeof stored === 'string' && stored.trim()) return stored.trim();
  } else {
    const stored = profile?.greetingText;
    if (typeof stored === 'string' && stored.trim()) return stored.trim();
  }
  return fromFixture || profile?.openers?.en || '';
}

module.exports = {
  TENANTS,
  DEMO_TENANT_UUIDS,
  demoTenant,
  isDemoTenantUuid,
  fixtureProfile,
  acceptStoredProfile,
  openerFor,
};
