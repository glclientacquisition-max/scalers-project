// Dynamic spoken lines — instant varied greeting; optional Gemini rewrite.

const { decideCallerEvent, isInterruptOnlyUtterance } = require('../speech/turnTaking');
const {
  eatTimeOfDay,
  composeBusinessAssistantIntro,
  introLooksValid,
} = require('./businessAssistantIntro');

/**
 * Instant greeting — brand-first English opener (see businessAssistantIntro.js).
 * Prefer this for first-audio latency (no Gemini wait on the critical path).
 * @param {string} businessName
 * @param {{ agentName?: string, isOpen?: boolean | null, afterHoursMode?: string, closureNotice?: string, now?: Date, variant?: number }} [opts]
 */
function fallbackGreeting(businessName, opts = {}) {
  return composeBusinessAssistantIntro({
    businessName,
    agentName: opts.agentName,
    offeringLine: opts.offeringLine,
    servicesCatalog: opts.servicesCatalog,
    servicesOffered: opts.servicesOffered || opts.servicesNotes,
    servicesNotes: opts.servicesNotes,
    isOpen: opts.isOpen,
    afterHoursMode: opts.afterHoursMode,
    closureNotice: opts.closureNotice,
    now: opts.now,
    variant: opts.variant,
  });
}

function cleanSpokenLine(text) {
  return String(text || '')
    .replace(/["“”']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^assistant:\s*/i, '')
    .trim();
}

function greetingLooksValid(line, businessName, agentName) {
  return introLooksValid(cleanSpokenLine(line), businessName, agentName);
}

/**
 * Generate call opener.
 * Default mode=instant: local varied line with business + agent name (fast).
 * mode=gemini: ask Gemini, fall back if slow/invalid.
 */
async function generateDynamicGreeting(opts) {
  const businessName = (opts.businessName || 'the business').trim();
  const agentName = String(opts.agentName || 'Receptionist').trim() || 'Receptionist';
  const isOpen = opts.isOpen;
  const mode = String(
    opts.mode || process.env.VOICE_GREETING_MODE || 'instant'
  ).toLowerCase();

  if (process.env.VOICE_GREETING) {
    return String(process.env.VOICE_GREETING).trim();
  }

  const afterHoursMode =
    String(opts.afterHoursMode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';
  const closureNotice = String(opts.closureNotice || '').trim();
  const offeringOpts = {
    offeringLine: opts.offeringLine,
    servicesCatalog: opts.servicesCatalog,
    servicesOffered: opts.servicesOffered || opts.servicesNotes,
    servicesNotes: opts.servicesNotes,
  };
  const instant = fallbackGreeting(businessName, {
    agentName,
    isOpen,
    afterHoursMode,
    closureNotice,
    ...offeringOpts,
  });
  if (mode !== 'gemini') return instant;

  const timeoutMs = Math.max(
    300,
    Number(opts.timeoutMs || process.env.VOICE_GREETING_TIMEOUT_MS || 700)
  );
  const tod = eatTimeOfDay();

  if (typeof opts.generateText !== 'function' || !process.env.GEMINI_API_KEY) {
    return instant;
  }

  const openLine = closureNotice
    ? afterHoursMode === 'message'
      ? `Today's update: "${closureNotice}". Mention that fact in natural words, then say you can take a message and ask for their name. Do not end on the fact alone.`
      : `Today's update: "${closureNotice}". Mention that fact in natural words, then say you can still help and ask how you can assist. Do not end on the fact alone.`
    : isOpen === false && afterHoursMode === 'message'
      ? 'The business is CLOSED now. Say you can take a message for the team.'
      : isOpen === false
        ? 'The business is CLOSED now, but you still help. Say you are closed yet can still assist.'
        : isOpen === true
          ? 'The business is OPEN now.'
          : 'Open/closed status is unknown; do not claim the shop is closed.';

  const { summarizeOfferingForIntro } = require('./businessAssistantIntro');
  const offering = summarizeOfferingForIntro(offeringOpts);
  const offeringRule = offering
    ? `After your name, include this exact offering clause (do not invent more): "${offering}"`
    : 'Do not invent what the business offers; skip any offering line if unknown.';

  const maxWords = closureNotice ? 44 : offering ? 38 : 28;
  const instruction = `You are ${agentName}, the live phone receptionist for ${businessName} in Kenya.
Write ONE short spoken greeting to open the call (max ${maxWords} words).
BRAND FIRST: lead with the business — e.g. "you've reached ${businessName}" or "thank you for calling ${businessName}".
You MUST include the exact business name "${businessName}".
You MUST introduce yourself as ${agentName} (e.g. "this is ${agentName} speaking").
${offeringRule}
You MUST tell the caller they can speak in English or Kiswahili (one short sentence).
It is ${tod} in Nairobi. ${openLine}
Use clear English for this first greeting (the caller has not spoken yet — do not open with Habari).
Sound warm and natural. No quotes, no markdown, never say "the business" as a placeholder.
End by inviting how you can help (or taking a message if closed in message mode).`;

  const task = opts
    .generateText({
      callSid: opts.callSid || 'greeting',
      systemInstruction: instruction,
      userText: `Greet the caller for ${businessName} as ${agentName}.`,
      temperature: 0.7,
      maxOutputTokens: 60,
      thinkingLevel: 'MINIMAL',
    })
    .then((raw) => {
      const line = cleanSpokenLine(raw);
      if (!greetingLooksValid(line, businessName, agentName)) return instant;
      return line;
    })
    .catch(() => instant);

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(instant), timeoutMs);
  });

  return Promise.race([task, timeout]);
}

/**
 * Optional tiny ack while Gemini thinks.
 */
function pickContextualAck(userText, lang) {
  const t = String(userText || '').toLowerCase();
  const asked = /\?|nani|gani|how|what|when|where|can you|unaweza|nataka|need|want/.test(t);
  if (lang === 'sw') return asked ? 'Sawa.' : 'Mm.';
  if (lang === 'sheng') return asked ? 'Poa.' : 'Mm.';
  return asked ? 'Alright.' : 'Mm-hmm.';
}

/**
 * Immediate progress line for action turns (order/save/escalate) so the caller
 * hears feedback while Gemini + tools run. Not a success claim — confirmation
 * still comes from the backend after tools finish.
 * @param {string} action
 * @param {string} [lang]
 */
function pickActionProgress(action, lang) {
  const a = String(action || '').toUpperCase();
  const sw = lang === 'sw' || lang === 'sheng';
  if (sw) {
    if (a === 'ESCALATE' || a === 'TRANSFER') return 'Sawa, ninashughulikia.';
    if (a === 'CREATE_REQUEST') return 'Sawa, ninaokoa hiyo.';
    if (a === 'CAPTURE') return 'Sawa.';
    return 'Sawa, ninashughulikia.';
  }
  if (a === 'ESCALATE') return 'Okay, let me get the team on that.';
  if (a === 'TRANSFER') return 'Okay, let me connect you.';
  if (a === 'CREATE_REQUEST') return 'Okay, let me save that.';
  if (a === 'CAPTURE') return 'Okay.';
  return "Okay, I'm on it.";
}

/**
 * Mid-call name ask used by human handoff and Gemini-down recovery.
 * One person: same sentence, not a new register.
 */
const REACH_THEM_NAME_ASK_EN = 'May I have your name so I can reach them?';
const REACH_THEM_NAME_ASK_SW = 'Niambie jina lako ndio niwasiliane nao.';

/**
 * Immediate spoken line while Gemini thinks on clarification / handoff turns.
 * Prevents dead air when the caller asked for a human but name is still missing
 * (ASK_CLARIFICATION — streaming path used to wait silently on the model).
 *
 * @param {{ action?: string, slot?: string, intent?: string, language?: string }} opts
 * @returns {string}
 */
function pickClarifyProgress(opts = {}) {
  const action = String(opts.action || '').toUpperCase();
  const slot = String(opts.slot || '').toLowerCase();
  const intent = String(opts.intent || '').toLowerCase();
  const lang = opts.language || 'en';
  const sw = lang === 'sw' || lang === 'sheng';
  const handoff =
    intent === 'human' || action === 'ESCALATE' || action === 'TRANSFER';

  if (handoff && (slot === 'name' || !slot)) {
    if (sw) return `Sawa. ${REACH_THEM_NAME_ASK_SW}`;
    return `Okay. ${REACH_THEM_NAME_ASK_EN}`;
  }
  if (slot === 'name') {
    if (sw) return 'Sawa. Niambie jina lako.';
    return 'Okay. May I have your name?';
  }
  if (sw) return 'Sawa, nimekuelewa.';
  return 'Okay.';
}

/**
 * Spoken line when Gemini is down. Same family as greeting / closed-message /
 * handoff: Okay opener, contractions, first person, honesty then still help.
 * Reuses the handoff name ask. Do not invent a booking. Do not say
 * "technical issue", "on this line", or "cannot".
 */
function pickLlmRecoveryLine(opts = {}) {
  const lang = opts.language || 'en';
  const sw = lang === 'sw' || lang === 'sheng';
  if (opts.alreadyOffered) {
    if (sw) return `Sawa, bado siwezi kumaliza. ${REACH_THEM_NAME_ASK_SW}`;
    return `Okay, I still can't finish that. ${REACH_THEM_NAME_ASK_EN}`;
  }
  if (sw) return `Sawa, siwezi kumaliza hiyo sasa hivi. ${REACH_THEM_NAME_ASK_SW}`;
  return `Okay, I can't finish that just now. ${REACH_THEM_NAME_ASK_EN}`;
}

function pickLlmRecoverySaved(opts = {}) {
  const lang = opts.language || 'en';
  const sw = lang === 'sw' || lang === 'sheng';
  if (sw) return 'Sawa, nimechukua jina lako. Nitawaambia timu wakupigie.';
  return "Okay, I have your name. I'll have the team reach you.";
}

function looksLikeCallerName(text) {
  const t = normalizeCallerText(text);
  if (!t || PURE_NOISE.has(t) || CONFIRM_ANSWERS.has(t)) return false;
  const hearAgain = t.replace(/[?'!.,]+$/g, '').trim();
  if (
    /^(pardon( me)?|sorry|what|huh|eh|come again|say( that)? again|repeat( that)?|nini|sema tena)$/i.test(
      hearAgain
    )
  ) {
    return false;
  }
  if (
    /\b(book|booking|carpet|couch|mattress|tomorrow|today|clean|appointment|huduma)\b/.test(
      t
    )
  ) {
    return false;
  }
  const words = t.split(' ').filter(Boolean);
  return words.length >= 1 && words.length <= 3 && t.length <= 40;
}

const PURE_NOISE = new Set([
  'ok',
  'okay',
  'yeah',
  'yep',
  'uh yeah',
  'uh huh',
  'hello',
  'hello?',
  'hi',
  'hey',
  'sawa',
  'mm',
  'hmm',
  'ah',
  'oh',
  'gemini',
  'pardon',
  'sorry',
  'what',
  'huh',
  'nini',
]);

const CONFIRM_ANSWERS = new Set([
  'yes',
  'no',
  'yeah',
  'yep',
  'yup',
  'nope',
  'ndiyo',
  'hapana',
  'correct',
  'right',
  'sawa',
  'exactly',
]);

function normalizeCallerText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Caller lines that should not burn a full Gemini turn. */
function isNonSubstantiveTurn(text) {
  const t = normalizeCallerText(text);
  if (!t) return true;
  if (t.length <= 2) return true;
  if (PURE_NOISE.has(t)) return true;
  if (CONFIRM_ANSWERS.has(t)) return true;
  if (/^(uh|um|ah|oh)\s*(yeah|yes|ok|okay)?$/.test(t)) return true;
  return false;
}

/** True when the last agent line is waiting on a yes/no or name reply. */
function looksLikeAwaitingCallerReply(agentText) {
  const t = String(agentText || '').toLowerCase();
  if (!t) return false;
  if (t.includes('?')) return true;
  return /\b(was that|did i hear|did you say|your name|may i (have|get)|spell|correct|right|confirm|who (am i|is this) speaking)\b/.test(
    t
  );
}

function looksLikeNamePrompt(agentText) {
  const t = String(agentText || '').toLowerCase();
  return /\b(your name|may i (have|get) your name|who (am i|is this) speaking|was that|did i hear|spell)\b/.test(
    t
  );
}

/**
 * Decide whether to skip a caller utterance before Gemini.
 * Keeps barge-in filters separate — short names and yes/no must reach the model
 * when the agent just asked for a name or confirmation.
 */
function shouldSkipCallerTurn(text, opts = {}) {
  const t = normalizeCallerText(text);
  if (!t) return true;

  const lastAgent = String(opts.lastAgentText || '');
  const awaiting = looksLikeAwaitingCallerReply(lastAgent);
  const decision = decideCallerEvent({
    text: t,
    speaking: false,
    turnBusy: false,
    lastAgentText: lastAgent,
    lastAgentAskedQuestion: awaiting,
    phase: 'idle',
    isFinal: true,
  });

  if (decision.runGemini) return false;

  // Short names like "John" / "Ann" / "Ali" — do not treat as noise after a name ask.
  if (awaiting && looksLikeNamePrompt(lastAgent) && looksLikeCallerName(t)) {
    return false;
  }

  if (
    decision.skip ||
    decision.replay ||
    decision.action === 'ignore' ||
    decision.action === 'skip' ||
    decision.action === 'barge_listen'
  ) {
    return true;
  }

  if (isNonSubstantiveTurn(t) && !awaiting) return true;
  return false;
}

module.exports = {
  eatTimeOfDay,
  fallbackGreeting,
  generateDynamicGreeting,
  pickContextualAck,
  pickActionProgress,
  pickClarifyProgress,
  pickLlmRecoveryLine,
  pickLlmRecoverySaved,
  looksLikeCallerName,
  cleanSpokenLine,
  greetingLooksValid,
  isNonSubstantiveTurn,
  isInterruptOnlyUtterance,
  shouldSkipCallerTurn,
  looksLikeAwaitingCallerReply,
  looksLikeNamePrompt,
};
