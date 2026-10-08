// src/tenantProfile.js
// Pure mapping from a tenants row to the voice profile the call path uses.
// db.getTenantProfile wraps it with open visits and the provenance envelope;
// scripts and tests use it to build the exact live prompt from a row snapshot.

/**
 * The voice profile for one tenants row. Pure: no database reads.
 * getTenantProfile adds open visits and the provenance envelope.
 * @param {object} row  tenants row
 * @param {{ openAppointments?: object[], fieldMeta?: object|null, holdGate?: object|null }} [extras]
 */
function tenantProfileFromRow(row, extras = {}) {
  const { parseAgentTools } = require('./conversation/agentTools');
  const { parseLexiconOverrides } = require('./speech/pronunciationLexicon');
  const { parseVertical } = require('./conversation/vertical');
  const { parseHandoffMode } = require('./conversation/handoffMode');
  const { parseNotifyChannels } = require('./notifications/notifyChannels');
  const afterHoursMode =
    String(row.after_hours_mode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';

  return {
    id: row.id,
    businessName: row.business_name,
    spokenName: row.spoken_name || null,
    greetingInvite: row.greeting_invite || null,
    agentName: row.agent_name || 'Receptionist',
    agentTone: row.agent_tone || null,
    llmSystemPrompt: row.llm_system_prompt || null,
    knowledge: process.env.BUSINESS_KNOWLEDGE || null,
    whatsappNumber: row.whatsapp_notification_number || null,
    alertEmail: row.alert_email || null,
    notifyChannels: parseNotifyChannels(row.notify_channels),
    did: row.sautikit_virtual_number || null,
    hoursSchedule: row.hours_schedule || null,
    businessHours: row.business_hours || null,
    afterHoursMode,
    servicesCatalog: row.services_catalog || [],
    productCatalog: row.product_catalog || [],
    socialHandles: row.social_handles || {},
    servicesOffered: row.services_offered || null,
    faqs: row.faqs || [],
    teamDirectory: row.team_directory || [],
    unknownAnswerFallback: row.unknown_answer_fallback || null,
    dailyBulletin: row.daily_bulletin || [],
    agentTools: parseAgentTools(row.agent_tools),
    ttsLexicon: parseLexiconOverrides(row.tts_lexicon),
    sonioxVoiceId: row.soniox_voice_id || null,
    sonioxVoiceLabel: row.soniox_voice_label || null,
    vertical: parseVertical(row.vertical),
    handoffMode: parseHandoffMode(row.handoff_mode),
    businessLocations: row.business_locations || [],
    businessPolicies: row.business_policies || {},
    billingEnforcement:
      row.billing_enforcement != null ? String(row.billing_enforcement) : null,
    walletBalanceKes:
      row.wallet_balance_kes != null ? Number(row.wallet_balance_kes) : null,
    openAppointments: Array.isArray(extras.openAppointments) ? extras.openAppointments : [],
    fieldMeta: extras.fieldMeta || null,
    holdGate: extras.holdGate || null,
  };
}

module.exports = { tenantProfileFromRow };
