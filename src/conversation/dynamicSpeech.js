// Dynamic spoken lines — greeting from Gemini; no canned "one moment" scripts.

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
 * Fast fallback if Gemini greeting is slow/unavailable.
 * Still varies by time of day — not one frozen script.
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

/**
 * Ask Gemini for a fresh one-line phone greeting.
 * Races a timeout so the caller is never left in silence too long.
 *
 * @param {object} opts
 * @param {string} opts.businessName
 * @param {string} [opts.callSid]
 * @param {(args: object) => Promise<string>} opts.generateText  thin Gemini wrapper
 * @param {number} [opts.timeoutMs]
 */
async function generateDynamicGreeting(opts) {
  const businessName = (opts.businessName || 'the business').trim();
  const timeoutMs = Math.max(300, Number(opts.timeoutMs || process.env.VOICE_GREETING_TIMEOUT_MS || 900));
  const tod = eatTimeOfDay();

  if (process.env.VOICE_GREETING) {
    return String(process.env.VOICE_GREETING).trim();
  }

  if (typeof opts.generateText !== 'function' || !process.env.GEMINI_API_KEY) {
    return fallbackGreeting(businessName);
  }

  const instruction = `You are the live phone receptionist for ${businessName} in Kenya.
Write ONE short spoken greeting to open the call (max 18 words).
It is ${tod} in Nairobi. Sound warm and natural — vary the wording, do not sound like a script.
English or light Kiswahili mix is fine. Invite them to say how you can help.
No quotes, no markdown, no name-asking yet, no company slogan dump.`;

  const task = opts
    .generateText({
      callSid: opts.callSid || 'greeting',
      systemInstruction: instruction,
      userText: 'Open the call now.',
      temperature: 0.9,
      maxOutputTokens: 60,
      thinkingLevel: 'MINIMAL',
    })
    .then((raw) => {
      const line = cleanSpokenLine(raw);
      if (!line || line.length > 160) return fallbackGreeting(businessName);
      return line;
    })
    .catch(() => fallbackGreeting(businessName));

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve(fallbackGreeting(businessName)), timeoutMs);
  });

  return Promise.race([task, timeout]);
}

/**
 * Optional tiny ack while Gemini thinks. Not a "checking" script —
 * just a natural human backchannel based on the caller's last line.
 * Default product behavior is silence (VOICE_FILLER=off).
 */
function pickContextualAck(userText, lang) {
  const t = String(userText || '').toLowerCase();
  const asked = /\?|nani|gani|how|what|when|where|can you|unaweza|nataka|need|want/.test(t);
  if (lang === 'sw') return asked ? 'Sawa.' : 'Mm.';
  if (lang === 'sheng') return asked ? 'Poa.' : 'Mm.';
  return asked ? 'Alright.' : 'Mm-hmm.';
}

module.exports = {
  eatTimeOfDay,
  fallbackGreeting,
  generateDynamicGreeting,
  pickContextualAck,
  cleanSpokenLine,
};
