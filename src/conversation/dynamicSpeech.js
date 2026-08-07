// Dynamic spoken lines — instant varied greeting; optional Gemini rewrite.

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
 * Instant greeting — correct business name, varies by time of day.
 * Prefer this for first-audio latency (no Gemini wait on the critical path).
 */
function fallbackGreeting(businessName) {
  const name = (businessName || process.env.BUSINESS_NAME || 'the business').trim();
  const tod = eatTimeOfDay();
  const options = {
    morning: [
      `Habari ya asubuhi, you've reached ${name}. How can I help?`,
      `Good morning, ${name} here. What can I do for you?`,
    ],
    afternoon: [
      `Habari, you've reached ${name}. How can I help you today?`,
      `Hello, ${name} — what can I help you with?`,
    ],
    evening: [
      `Habari ya jioni, you've reached ${name}. How can I help?`,
      `Good evening, ${name} here. How can I help you?`,
    ],
  };
  const list = options[tod] || options.afternoon;
  return list[Math.floor(Math.random() * list.length)];
}

function cleanSpokenLine(text) {
  return String(text || '')
    .replace(/["“”]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^assistant:\s*/i, '')
    .trim();
}

function greetingLooksValid(line, businessName) {
  const text = cleanSpokenLine(line);
  if (!text || text.length > 160) return false;
  const name = String(businessName || '').trim();
  if (!name || /^the business$/i.test(name)) return true;
  // Reject Gemini slips like "Good evening, the business here…"
  if (/\bthe business\b/i.test(text) && !/\bthe business\b/i.test(name)) return false;
  // Prefer greetings that actually say the business name.
  const nameToken = name.split(/\s+/)[0];
  if (nameToken && nameToken.length >= 3) {
    return text.toLowerCase().includes(nameToken.toLowerCase());
  }
  return true;
}

/**
 * Generate call opener.
 * Default mode=instant: local varied line with the real business name (fast).
 * mode=gemini: ask Gemini, fall back if slow/invalid.
 */
async function generateDynamicGreeting(opts) {
  const businessName = (opts.businessName || 'the business').trim();
  const mode = String(
    opts.mode || process.env.VOICE_GREETING_MODE || 'instant'
  ).toLowerCase();

  if (process.env.VOICE_GREETING) {
    return String(process.env.VOICE_GREETING).trim();
  }

  const instant = fallbackGreeting(businessName);
  if (mode !== 'gemini') return instant;

  const timeoutMs = Math.max(
    300,
    Number(opts.timeoutMs || process.env.VOICE_GREETING_TIMEOUT_MS || 700)
  );
  const tod = eatTimeOfDay();

  if (typeof opts.generateText !== 'function' || !process.env.GEMINI_API_KEY) {
    return instant;
  }

  const instruction = `You are the live phone receptionist for ${businessName} in Kenya.
Write ONE short spoken greeting to open the call (max 16 words).
You MUST include the exact business name "${businessName}" in the greeting.
It is ${tod} in Nairobi. Sound warm and natural — vary the wording.
English or light Kiswahili mix is fine. Invite them to say how you can help.
No quotes, no markdown, never say "the business" as a placeholder.`;

  const task = opts
    .generateText({
      callSid: opts.callSid || 'greeting',
      systemInstruction: instruction,
      userText: `Greet the caller for ${businessName}.`,
      temperature: 0.85,
      maxOutputTokens: 50,
      thinkingLevel: 'MINIMAL',
    })
    .then((raw) => {
      const line = cleanSpokenLine(raw);
      if (!greetingLooksValid(line, businessName)) return instant;
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

/** Caller lines that should not burn a full Gemini turn. */
function isNonSubstantiveTurn(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'?-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  const noise = new Set([
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
    'yes',
    'no',
  ]);
  if (noise.has(t)) return true;
  // Pure filler like "Uh, yeah."
  if (/^(uh|um|ah|oh)\s*(yeah|yes|ok|okay)?$/.test(t)) return true;
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
};
