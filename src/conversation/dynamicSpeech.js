// Dynamic spoken lines — instant varied greeting; optional Gemini rewrite.

const { isInterruptOnlyUtterance } = require('../speech/turnTaking');

/**
 * Nairobi/EAT time-of-day bucket for natural openers.
 * @returns {'morning'|'afternoon'|'evening'}
 */
function eatTimeOfDay(date = new Date()) {
  const hour = (date.getUTCHours() + 3) % 24; // Africa/Nairobi ≈ UTC+3
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * Instant greeting — business name + agent name, varies by time / open status.
 * Prefer this for first-audio latency (no Gemini wait on the critical path).
 * @param {string} businessName
 * @param {{ agentName?: string, isOpen?: boolean | null }} [opts]
 */
function fallbackGreeting(businessName, opts = {}) {
  const name = (businessName || process.env.BUSINESS_NAME || 'the business').trim();
  const agent = String(opts.agentName || 'Receptionist').trim() || 'Receptionist';
  const tod = eatTimeOfDay();
  const closed = opts.isOpen === false;
  const afterHoursMode =
    String(opts.afterHoursMode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';
  const closureNotice = String(opts.closureNotice || '').trim();

  // Today's update says closed — state the fact, then keep the call moving.
  if (closureNotice) {
    let short =
      closureNotice.length > 90
        ? `${closureNotice.slice(0, 87).trim()}...`
        : closureNotice;
    if (!/[.!?…]$/.test(short)) short = `${short}.`;
    const follow =
      afterHoursMode === 'message'
        ? 'I can still take a message. May I have your name?'
        : 'Even so, I can still help. How can I assist?';
    const options = {
      morning: [
        `Good morning, you've reached ${name}, this is ${agent}. ${short} ${follow}`,
        `Habari ya asubuhi, ${name}, ${agent} speaking. ${short} ${follow}`,
      ],
      afternoon: [
        `Hello, you've reached ${name}, this is ${agent}. ${short} ${follow}`,
        `Habari, ${name}, ${agent} speaking. ${short} ${follow}`,
      ],
      evening: [
        `Good evening, you've reached ${name}, this is ${agent}. ${short} ${follow}`,
        `Habari ya jioni, ${name}, ${agent} speaking. ${short} ${follow}`,
      ],
    };
    const list = options[tod] || options.afternoon;
    return list[Math.floor(Math.random() * list.length)];
  }

  if (closed && afterHoursMode === 'message') {
    const closedOptions = {
      morning: [
        `Good morning, you've reached ${name}, this is ${agent}. We're closed right now, but I can take a message.`,
        `Habari ya asubuhi, ${name}, ${agent} speaking. We're closed, but I can note your request.`,
      ],
      afternoon: [
        `Hello, you've reached ${name}, this is ${agent}. We're closed right now, but I can take a message.`,
        `Habari, ${name}, ${agent} speaking. We're closed, but I can note your request for the team.`,
      ],
      evening: [
        `Good evening, you've reached ${name}, this is ${agent}. We're closed right now, but I can take a message.`,
        `Habari ya jioni, ${name}, ${agent} speaking. We're closed, but I can note your request.`,
      ],
    };
    const list = closedOptions[tod] || closedOptions.afternoon;
    return list[Math.floor(Math.random() * list.length)];
  }

  if (closed) {
    // Default: still serve after hours — be honest about closed status, then help.
    const serveClosed = {
      morning: [
        `Good morning, you've reached ${name}, this is ${agent}. We're closed now, but I can still help. How can I assist?`,
        `Habari ya asubuhi, ${name}, ${agent} speaking. We're closed, but I can still help you.`,
      ],
      afternoon: [
        `Hello, you've reached ${name}, this is ${agent}. We're closed right now, but I can still help. What do you need?`,
        `Habari, ${name}, ${agent} speaking. We're closed, but I can still answer you.`,
      ],
      evening: [
        `Good evening, you've reached ${name}, this is ${agent}. We're closed now, but I can still help. How can I assist?`,
        `Habari ya jioni, ${name}, ${agent} speaking. We're closed, but I can still help you.`,
      ],
    };
    const list = serveClosed[tod] || serveClosed.afternoon;
    return list[Math.floor(Math.random() * list.length)];
  }

  const options = {
    morning: [
      `Good morning, you've reached ${name}, this is ${agent} speaking. How can I help?`,
      `Habari ya asubuhi, you've reached ${name}, this is ${agent}. How can I help?`,
    ],
    afternoon: [
      `Hello, you've reached ${name}, this is ${agent} speaking. How can I help you today?`,
      `Habari, you've reached ${name}, this is ${agent}. How can I help?`,
    ],
    evening: [
      `Good evening, you've reached ${name}, this is ${agent} speaking. How can I help?`,
      `Habari ya jioni, you've reached ${name}, this is ${agent}. How can I help?`,
    ],
  };
  const list = options[tod] || options.afternoon;
  return list[Math.floor(Math.random() * list.length)];
}

function cleanSpokenLine(text) {
  return String(text || '')
    .replace(/["“”']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^assistant:\s*/i, '')
    .trim();
}

function greetingLooksValid(line, businessName, agentName) {
  const text = cleanSpokenLine(line);
  if (!text || text.length > 240) return false;
  const name = String(businessName || '').trim();
  if (!name || /^the business$/i.test(name)) return true;
  if (/\bthe business\b/i.test(text) && !/\bthe business\b/i.test(name)) return false;
  const nameToken = name.split(/\s+/)[0];
  if (nameToken && nameToken.length >= 3) {
    if (!text.toLowerCase().includes(nameToken.toLowerCase())) return false;
  }
  const agent = String(agentName || '').trim();
  if (agent && agent.length >= 2 && !/^receptionist$/i.test(agent)) {
    if (!text.toLowerCase().includes(agent.toLowerCase())) return false;
  }
  return true;
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
  const instant = fallbackGreeting(businessName, {
    agentName,
    isOpen,
    afterHoursMode,
    closureNotice,
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

  const maxWords = closureNotice ? 36 : 20;
  const instruction = `You are ${agentName}, the live phone receptionist for ${businessName} in Kenya.
Write ONE short spoken greeting to open the call (max ${maxWords} words).
You MUST include the exact business name "${businessName}".
You MUST introduce yourself as ${agentName} (e.g. "this is ${agentName} speaking").
It is ${tod} in Nairobi. ${openLine}
Sound warm and natural. English or light Kiswahili mix is fine.
No quotes, no markdown, never say "the business" as a placeholder.`;

  const task = opts
    .generateText({
      callSid: opts.callSid || 'greeting',
      systemInstruction: instruction,
      userText: `Greet the caller for ${businessName} as ${agentName}.`,
      temperature: 0.85,
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

  // After barge-in, interrupt-only finals should yield silence — not "I'm listening…".
  if (isInterruptOnlyUtterance(t)) return true;

  const lastAgent = String(opts.lastAgentText || '');
  const awaiting = looksLikeAwaitingCallerReply(lastAgent);

  // Corrections with substance must reach the model ("no, it's Ann").
  if (/^(no|nope|actually|it's|it is|not |correction)\b/.test(t) && !isInterruptOnlyUtterance(t)) {
    return false;
  }

  if (awaiting && CONFIRM_ANSWERS.has(t)) return false;

  // Short names like "John" / "Ann" / "Ali" — do not treat as noise after a name ask.
  if (awaiting && looksLikeNamePrompt(lastAgent)) {
    const words = t.split(' ').filter(Boolean);
    if (words.length <= 3 && t.length <= 40 && !PURE_NOISE.has(t)) return false;
  }

  if (isNonSubstantiveTurn(t)) return true;
  return false;
}

module.exports = {
  eatTimeOfDay,
  fallbackGreeting,
  generateDynamicGreeting,
  pickContextualAck,
  cleanSpokenLine,
  greetingLooksValid,
  isNonSubstantiveTurn,
  isInterruptOnlyUtterance,
  shouldSkipCallerTurn,
  looksLikeAwaitingCallerReply,
  looksLikeNamePrompt,
};
