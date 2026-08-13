/**
 * Business assistant introduction — canonical phone opener.
 *
 * Top-level rules (MVP unanswered-call path):
 * 1. Brand first — business name is the hero signal in the first sentence.
 * 2. Agent named — callers know who is speaking.
 * 3. English-default on first open — do not lottery-open in Kiswahili before
 *    the caller has spoken (prevents sticky language flip).
 * 4. One job — invite the caller need; no promo, stats, or policy dump.
 * 5. Closed honesty — state closed/bulletin briefly, then still help or take a message.
 */

function eatTimeOfDay(date = new Date()) {
  const hour = (date.getUTCHours() + 3) % 24; // Africa/Nairobi ≈ UTC+3
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function cleanName(value, fallback) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || fallback;
}

function shortenNotice(notice, max = 90) {
  let short = String(notice || '').replace(/\s+/g, ' ').trim();
  if (!short) return '';
  if (short.length > max) short = `${short.slice(0, max - 3).trim()}...`;
  if (!/[.!?…]$/.test(short)) short = `${short}.`;
  return short;
}

/**
 * Time-of-day opener in English (first contact only).
 * @returns {'Good morning'|'Hello'|'Good evening'}
 */
function englishDayOpener(tod) {
  if (tod === 'morning') return 'Good morning';
  if (tod === 'evening') return 'Good evening';
  return 'Hello';
}

/**
 * Compose the spoken introduction for a live unanswered-call answer.
 *
 * @param {{
 *   businessName?: string,
 *   agentName?: string,
 *   isOpen?: boolean|null,
 *   afterHoursMode?: string,
 *   closureNotice?: string,
 *   now?: Date,
 *   variant?: number,
 * }} opts
 * @returns {string}
 */
function composeBusinessAssistantIntro(opts = {}) {
  const businessName = cleanName(
    opts.businessName || process.env.BUSINESS_NAME,
    'the business'
  );
  const agentName = cleanName(opts.agentName, 'Receptionist');
  const tod = eatTimeOfDay(opts.now || new Date());
  const opener = englishDayOpener(tod);
  const afterHoursMode =
    String(opts.afterHoursMode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';
  const closureNotice = shortenNotice(opts.closureNotice);
  const closed = opts.isOpen === false;

  // Variant 0 = primary brand-first line; 1 = thank-you alternate (still English).
  const variant =
    typeof opts.variant === 'number'
      ? opts.variant
      : Math.floor(Math.random() * 2);

  const identityPrimary = `${opener}, you've reached ${businessName}, this is ${agentName} speaking.`;
  const identityThanks = `Thank you for calling ${businessName}, this is ${agentName} speaking.`;
  const identity = variant === 1 ? identityThanks : identityPrimary;

  if (closureNotice) {
    const follow =
      afterHoursMode === 'message'
        ? 'I can still take a message. May I have your name?'
        : 'Even so, I can still help. How can I assist?';
    return `${identity} ${closureNotice} ${follow}`;
  }

  if (closed && afterHoursMode === 'message') {
    return `${identity} We're closed right now, but I can take a message.`;
  }

  if (closed) {
    return `${identity} We're closed now, but I can still help. How can I assist?`;
  }

  return `${identity} How can I help?`;
}

/**
 * Desk / Test preview — deterministic primary English open (no random).
 */
function previewBusinessAssistantIntro(opts = {}) {
  return composeBusinessAssistantIntro({
    ...opts,
    variant: 0,
    now: opts.now || new Date('2026-08-13T10:00:00.000Z'), // stable afternoon EAT for previews unless overridden
  });
}

function introLooksValid(line, businessName, agentName) {
  const text = String(line || '')
    .replace(/["“”']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 280) return false;
  const name = String(businessName || '').trim();
  if (name && !/^the business$/i.test(name)) {
    const nameToken = name.split(/\s+/)[0];
    if (nameToken && nameToken.length >= 3) {
      if (!text.toLowerCase().includes(nameToken.toLowerCase())) return false;
    }
    if (/\bthe business\b/i.test(text) && !/\bthe business\b/i.test(name)) {
      return false;
    }
  }
  const agent = String(agentName || '').trim();
  if (agent && agent.length >= 2 && !/^receptionist$/i.test(agent)) {
    if (!text.toLowerCase().includes(agent.toLowerCase())) return false;
  }
  // First open must not be Kiswahili-led (language match happens after caller speaks).
  if (/^\s*habari\b/i.test(text)) return false;
  return true;
}

module.exports = {
  eatTimeOfDay,
  englishDayOpener,
  composeBusinessAssistantIntro,
  previewBusinessAssistantIntro,
  introLooksValid,
  shortenNotice,
};
