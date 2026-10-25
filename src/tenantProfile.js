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
/**
 * { closed: true, reason } for an archived, suspended or is_active=false row;
 * null when the line is live. src/sautikit/inactiveTenantGate.js decides.
 */
function tenantRowLineState(row) {
  const { tenantLineInactiveReason } = require('./sautikit/inactiveTenantGate');
  const reason = tenantLineInactiveReason(row);
  return reason ? { closed: true, reason, tenantId: row?.id || null } : null;
}

// tenants.greeting_language is en or sw (check constraint). Anything else is null.
function parseGreetingLanguage(value) {
  const v = String(value || '').trim().toLowerCase();
  return v === 'en' || v === 'sw' ? v : null;
}

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
    // greeting_language.sql (13c). null on an unmigrated database or empty field.
    greetingText: row.greeting_text || null,
    greetingLanguage: parseGreetingLanguage(row.greeting_language),
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
    unknownAnswerSpoken: extras.unknownAnswerSpoken ?? row.unknown_answer_spoken ?? null,
    // Desk Settings › Service areas (public.tenant_area_picks rows); null = no rows / no table -> legacy lists
    areaPicksRows: extras.areaPicksRows ?? null,
    areaPicks: extras.areaPicks ?? null,
    areaPicksConfirmedAt: extras.areaPicksConfirmedAt ?? null,
    unknownAnswerByKind: require('./conversation/unknownAnswerByKind').parseByKind(
      row.unknown_answer_by_kind
    ),
    dailyBulletin: row.daily_bulletin || [],
    agentTools: parseAgentTools(row.agent_tools),
    ttsLexicon: parseLexiconOverrides(row.tts_lexicon),
    sonioxVoiceId: row.soniox_voice_id || null,
    sonioxVoiceLabel: row.soniox_voice_label || null,
    vertical: parseVertical(row.vertical),
    // Settings › Locations area terms (fee, time, mode) from tenants.service_areas.
    areaTerms: require('./conversation/areaTerms').readAreaTerms(
      row.service_areas !== undefined ? row.service_areas : extras.serviceAreas,
      { vertical: parseVertical(row.vertical) }
    ),
    handoffMode: parseHandoffMode(row.handoff_mode),
    businessLocations: row.business_locations || [],
    service_areas: row.service_areas ?? null,
    // SPOKEN_CATALOGUE_STORED_FIRST only: v2 area logic reads profile.serviceAreas,
    // so loading it changes call behaviour; gated with the stored-first flag.
    ...(require('./knowledge/spokenCatalogue').storedFirst() ? { serviceAreas: require('./knowledge/spokenCatalogue').catalogueProfileFromRow({ ...row, service_areas: row.service_areas !== undefined ? row.service_areas : extras.serviceAreas }).serviceAreas } : {}),
    businessPolicies: row.business_policies || {},
    billingEnforcement:
      row.billing_enforcement != null ? String(row.billing_enforcement) : null,
    walletBalanceKes:
      row.wallet_balance_kes != null ? Number(row.wallet_balance_kes) : null,
    // archived / suspended / is_active=false, same rules as the inbound gate.
    // null when the row is live (or an older schema lacks the columns).
    lineState: tenantRowLineState(row),
    openAppointments: Array.isArray(extras.openAppointments) ? extras.openAppointments : [],
    fieldMeta: extras.fieldMeta || null,
    holdGate: extras.holdGate || null,
    // VOICE_V2_CATALOGUE only: stored speech-ready KB (null until Platform's column exists / backfill runs).
    ...(/^(1|true|on|yes)$/i.test(String(process.env.VOICE_V2_CATALOGUE || '')) ? { spokenCatalogue: row.spoken_catalogue || null } : {}),
  };
}

module.exports = { tenantProfileFromRow };
