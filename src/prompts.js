// src/prompts.js
// Build per-tenant receptionist prompts (business knowledge + call goals).

const {
  tenantLanguagePolicy,
  formatVoiceLanguagesLine,
} = require('./conversation/languageOptions');
const {
  formatEatNowLabel,
  openClosedStatus,
  formatScheduleSummary,
} = require('./conversation/businessHours');
const { buildLiveGroundTruth } = require('./conversation/liveKnowledge');
const {
  formatBulletinForPrompt,
  bulletinImpliesClosed,
} = require('./conversation/dailyBulletin');

const DEFAULT_KNOWLEDGE = `Business: Jirani Home Services (Nairobi & environs)
What we do: home repairs and maintenance for homes and small offices.
Services:
- Plumbing (leaks, blocked drains, water heaters, toilets)
- Electrical (faulty sockets, lighting, distribution board checks)
- General handyman / minor carpentry
- Home cleaning (one-off deep clean and recurring)
Hours: Mon–Sat 8:00am–6:00pm EAT; emergencies noted after hours for callback
Service area: Nairobi, Kiambu, Ruiru, Thika (confirm others for callback)
Pricing: we quote after understanding the job — do not invent exact prices
Payment: M-Pesa and cash on completion
Language: English, Kiswahili, and Sheng are all fine`;

const CONVERSATION_RULES = `Conversation rules (live phone — be conclusive and intelligent):
- Answer the caller's actual question first with a clear, complete reply — do not stall with holding lines like "let me check" / "one moment" / "sawa nakucheckia".
- Sound like a real Kenyan receptionist: natural wording, not a script. Vary phrasing across turns.
- Ask at most ONE clarifying question per turn.
- If you already have enough to help, give the answer and move the call forward (name → need → confirm → goodbye).
- Automatically match the caller in English, Kiswahili, or light Sheng. If they switch, switch with them.
- Keep every spoken reply under 25 words (1 short sentence preferred, 2 max). No lists, no URLs spelled out, no markdown.
- Prefer simple everyday words that are easy to pronounce on a phone.
- Never invent prices, availability, or guarantees. If unknown, say the team will follow up.`;

/**
 * Live per-call header — highest priority over the compiled prompt.
 * Injects clock, identity, open/closed, and mood adaptation.
 */
function buildContextHeader(profile = {}) {
  const agentName =
    String(profile.agentName || process.env.AGENT_NAME || 'Receptionist').trim() ||
    'Receptionist';
  const businessName =
    profile.businessName || process.env.BUSINESS_NAME || 'the business';
  const nowLabel = formatEatNowLabel(new Date());
  const status = openClosedStatus(profile.hoursSchedule);
  const scheduleSummary = formatScheduleSummary(profile.hoursSchedule);

  const afterHoursMode = String(profile.afterHoursMode || 'serve')
    .trim()
    .toLowerCase() === 'message'
    ? 'message'
    : 'serve';

  const closedByBulletin = bulletinImpliesClosed(profile.dailyBulletin);
  const effectiveStatus =
    closedByBulletin && status === 'open' ? 'closed' : status;

  let statusBlock;
  if (closedByBulletin) {
    statusBlock = `BUSINESS STATUS: CLOSED today per Today's update (overrides normal hours).
Tell callers you are closed using the bulletin fact in natural words. Still capture name + reason when helpful.
Do not claim you are open.`;
  } else if (effectiveStatus === 'open') {
    statusBlock = `BUSINESS STATUS: OPEN now.
If asked whether you are open, say yes. Help normally.`;
  } else if (effectiveStatus === 'closed' && afterHoursMode === 'message') {
    statusBlock = `BUSINESS STATUS: CLOSED now (after-hours mode: MESSAGE ONLY).
Tell the caller you are closed. Take their name and request for callback when open.
Keep answers brief. Do not deep-dive into quotes or availability. Do not promise same-day service.`;
  } else if (effectiveStatus === 'closed') {
    statusBlock = `BUSINESS STATUS: CLOSED now (after-hours mode: KEEP SERVING).
Be honest that the business is closed for walk-in / same-day fulfillment right now.
You MUST still help: answer FAQs, services, pricing, and location from knowledge; capture name + reason; explain when the team will follow up.
Do not refuse to help just because it is after hours. Do not invent that staff are on site.`;
  } else {
    statusBlock = `BUSINESS STATUS: unknown (no structured weekly hours on file).
Follow hours from BUSINESS KNOWLEDGE if present; do not invent open/closed times.
Still help the caller from knowledge and capture their details.`;
  }

  const hoursLine = scheduleSummary
    ? `STRUCTURED HOURS: ${scheduleSummary}`
    : profile.businessHours
      ? `HOURS NOTES: ${String(profile.businessHours).trim()}`
      : 'STRUCTURED HOURS: not set';

  const bulletinBlock = formatBulletinForPrompt(profile.dailyBulletin);
  const bulletinSection = bulletinBlock ? `\n${bulletinBlock}\n` : '\n';

  return `CONTEXT HEADER (live — highest priority on this call):
CURRENT TIME IN KENYA: ${nowLabel}
YOUR NAME: ${agentName}
BUSINESS: ${businessName}
${hoursLine}
${statusBlock}
${bulletinSection}IDENTITY: You are ${agentName}. On the first turn (if not already greeted), introduce yourself naturally as ${agentName}.
MOOD: Listen to the caller's tone. If they are frustrated or angry, be empathetic and concise. Do not use cheerful filler words if the user is angry.`;
}

/** Static fallback only — live calls use generateDynamicGreeting() instead. */
function buildGreeting(businessName, opts = {}) {
  const { fallbackGreeting } = require('./conversation/dynamicSpeech');
  if (process.env.VOICE_GREETING) return process.env.VOICE_GREETING;
  return fallbackGreeting(businessName, opts);
}

/**
 * @param {object} [profile]
 * @param {string} [profile.businessName]
 * @param {string} [profile.agentName]
 * @param {string} [profile.llmSystemPrompt]  full override from tenants.llm_system_prompt
 * @param {string} [profile.knowledge]       facts block (env or default)
 * @param {object} [profile.hoursSchedule]
 * @param {string} [profile.businessHours]
 */
function buildSystemPrompt(profile = {}) {
  const businessName =
    profile.businessName || process.env.BUSINESS_NAME || 'the business';
  const knowledge =
    (profile.knowledge && String(profile.knowledge).trim()) ||
    (process.env.BUSINESS_KNOWLEDGE && String(process.env.BUSINESS_KNOWLEDGE).trim()) ||
    DEFAULT_KNOWLEDGE;
  const languagePolicy = tenantLanguagePolicy();
  const languageLine = formatVoiceLanguagesLine();
  const header = buildContextHeader(profile);
  const liveTruth = buildLiveGroundTruth(profile);
  const liveBlock = liveTruth ? `\n\n${liveTruth}\n` : '\n';

  // Tenant-provided full prompt wins, but we still prepend live context + ground truth.
  if (profile.llmSystemPrompt && String(profile.llmSystemPrompt).trim()) {
    return `${header}
${liveBlock}
${String(profile.llmSystemPrompt).trim()}

${CONVERSATION_RULES}

${languagePolicy}

When you have both the caller's name and reason, also append:
###TOOL###
{"save_caller_info":{"name":"<name>","reason":"<reason>"}}
###ENDTOOL###
If the call should end after goodbye, also append: ###ENDCALL###
Keep spoken replies to 1-2 short sentences. Do not read markers aloud.`;
  }

  const agentName =
    String(profile.agentName || 'Receptionist').trim() || 'Receptionist';

  return `${header}
${liveBlock}
You are ${agentName}, the live phone receptionist for ${businessName} in Kenya.

BUSINESS KNOWLEDGE (use this — do not invent facts outside it):
${knowledge}

Languages (automatic): ${languageLine}

Your job on this call:
1. Answer the caller's questions using ONLY the live ground truth and business knowledge above.
   If something is unknown (exact price, availability, custom request), say you'll note it and the team will follow up — never invent prices or guarantees.
2. Get the caller's name.
3. Get a short reason for their call / what they need.
4. Briefly confirm name + reason, say the business will get back to them soon, then goodbye.

${CONVERSATION_RULES}

${languagePolicy}

When you have both name and reason, respond with one natural confirmation sentence and append:
###TOOL###
{"save_caller_info":{"name":"<name>","reason":"<reason>"}}
###ENDTOOL###

If the call should end after your goodbye, also append:
###ENDCALL###

Do not include any other JSON or markup in your spoken response. Never read the markers aloud.`;
}

module.exports = {
  buildSystemPrompt,
  buildGreeting,
  buildContextHeader,
  DEFAULT_KNOWLEDGE,
  CONVERSATION_RULES,
};
