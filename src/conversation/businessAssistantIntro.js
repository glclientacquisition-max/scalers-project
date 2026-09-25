/**
 * Business assistant introduction — canonical phone opener.
 *
 * First-forward rules (Kenya unanswered / forwarded line):
 * 1. Shop first, then the named person, then one question.
 * 2. Do not list services on the first open (callers drop on a catalog dump).
 * 3. Do not invite language on first audio. Match after they speak.
 * 4. English-default on first open. Do not lottery-open with Habari.
 * 5. Closed honesty stays one short clause, then the same question.
 * 6. Message-only still asks for a name.
 * 7. Never speak a default shop name ("the business").
 */

const LANGUAGE_INVITE = 'You can speak in English or Kiswahili.';

const FORBIDDEN_FIRST_OPEN =
  /\b(thank you for calling|you('ve| have) reached|we help with|owner is away|i am an ai|virtual assistant|intelligent agent|press [0-9]|stay on the line|english or kiswahili)\b/i;

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

function isDefaultShopName(value) {
  const shop = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return !shop || /^the business$/i.test(shop);
}

function isDefaultAgentName(value) {
  const agent = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return !agent || /^receptionist$/i.test(agent);
}

function shortenNotice(notice, max = 90) {
  let short = String(notice || '').replace(/\s+/g, ' ').trim();
  if (!short) return '';
  if (short.length > max) short = `${short.slice(0, max - 3).trim()}...`;
  if (!/[.!?…]$/.test(short)) short = `${short}.`;
  return short;
}

/**
 * Time-of-day first-word swap. Does not add a second sentence.
 * Afternoon stays shop-first with no Hello.
 * @returns {string} prefix including trailing ", " or ""
 */
function dayWordPrefix(tod) {
  if (tod === 'morning') return 'Good morning, ';
  if (tod === 'evening') return 'Good evening, ';
  return '';
}

function asServiceArray(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Filter desk/meta catalogue labels that must never be spoken on the phone.
 * Esgar had rows like "What they offer (confirmed):" and "When asked…".
 */
function isSpeakableOfferingName(name) {
  const text = String(name || '').replace(/\s+/g, ' ').trim();
  if (!text || text.length < 3 || text.length > 48) return false;
  if (/[:→]/.test(text)) return false;
  if (
    /\b(confirmed|confidence|when asked|receptionist|routing|sku|how much|how the)\b/i.test(
      text
    )
  ) {
    return false;
  }
  if (/^(products?\s*&\s*pricing|what they offer)\b/i.test(text)) return false;
  return true;
}

/**
 * One short spoken clause about what the business offers.
 * Grounded only in services catalog / services notes — never invents.
 * Kept for later turns / desk preview. Never spoken on first open.
 * @returns {string} e.g. "We help with books, special orders, and delivery." or ""
 */
function summarizeOfferingForIntro(opts = {}) {
  if (opts.offeringLine != null && String(opts.offeringLine).trim()) {
    return formatOfferingClause(String(opts.offeringLine).trim());
  }

  const fromCatalog = asServiceArray(opts.servicesCatalog)
    .map((row) => String(row?.name || '').trim())
    .filter((name) => isSpeakableOfferingName(name))
    .slice(0, 3);

  if (fromCatalog.length) {
    let list;
    if (fromCatalog.length === 1) list = fromCatalog[0];
    else if (fromCatalog.length === 2) list = `${fromCatalog[0]} and ${fromCatalog[1]}`;
    else list = `${fromCatalog[0]}, ${fromCatalog[1]}, and ${fromCatalog[2]}`;
    const clause = /^(we |our )/i.test(list)
      ? list
      : `We help with ${list.toLowerCase()}.`;
    return formatOfferingClause(clause);
  }

  const notes = String(opts.servicesOffered || opts.servicesNotes || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!notes) return '';
  const first = notes.split(/(?<=[.!?])\s+|\n/)[0] || notes;
  if (first.length < 8 || first.length > 90) return '';
  if ((first.match(/,/g) || []).length >= 4) return '';
  return formatOfferingClause(first);
}

function formatOfferingClause(raw) {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length > 96) text = `${text.slice(0, 93).trim()}...`;
  if (!/[.!?…]$/.test(text)) text = `${text}.`;
  if (!/^(we |our )/i.test(text) && text.length < 70) {
    text = `We help with ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
    if (!/[.!?…]$/.test(text)) text = `${text}.`;
  }
  return text;
}

/**
 * Shop-first identity. Morning/evening is a first-word swap only.
 * @returns {string} e.g. "ChapterOne Bookstore, this is Aisha."
 */
function composeOpenerIdentity(opts = {}) {
  const businessName = cleanName(
    opts.businessName || process.env.BUSINESS_NAME,
    'the business'
  );
  const agentName = cleanName(opts.agentName, '');
  const tod = eatTimeOfDay(opts.now || new Date());
  const day = dayWordPrefix(tod);
  if (!isDefaultAgentName(agentName)) {
    return `${day}${businessName}, this is ${agentName}.`;
  }
  return `${day}${businessName}.`;
}

/**
 * Compose the spoken introduction for a live unanswered-call answer.
 *
 * @param {{
 *   businessName?: string,
 *   agentName?: string,
 *   offeringLine?: string,
 *   servicesCatalog?: Array|{name?: string}|string,
 *   servicesOffered?: string,
 *   servicesNotes?: string,
 *   isOpen?: boolean|null,
 *   afterHoursMode?: string,
 *   closureNotice?: string,
 *   now?: Date,
 *   variant?: number,
 * }} opts
 * @returns {string}
 */
function composeBusinessAssistantIntro(opts = {}) {
  const afterHoursMode =
    String(opts.afterHoursMode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';
  const closureNotice = shortenNotice(opts.closureNotice);
  const closed = opts.isOpen === false;
  const identity = composeOpenerIdentity(opts);
  const help = 'How can I help?';
  const nameAsk = 'May I have your name?';

  if (closureNotice) {
    const follow = afterHoursMode === 'message' ? nameAsk : help;
    return `${identity} ${closureNotice} ${follow}`;
  }

  if (closed && afterHoursMode === 'message') {
    return `${identity} We're closed now. ${nameAsk}`;
  }

  if (closed) {
    return `${identity} We're closed now. ${help}`;
  }

  return `${identity} ${help}`;
}

/**
 * Desk / Test preview — deterministic primary English open (no random).
 */
function previewBusinessAssistantIntro(opts = {}) {
  return composeBusinessAssistantIntro({
    ...opts,
    variant: 0,
    now: opts.now || new Date('2026-08-13T10:00:00.000Z'),
  });
}

function introLooksValid(line, businessName, agentName) {
  const text = String(line || '')
    .replace(/["“”']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 220) return false;
  if (FORBIDDEN_FIRST_OPEN.test(text)) return false;
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
  if (/^\s*habari\b/i.test(text)) return false;
  if (
    !/\bhow can i help\b/i.test(text) &&
    !/\bmay i have your name\b/i.test(text)
  ) {
    return false;
  }
  return true;
}

module.exports = {
  eatTimeOfDay,
  LANGUAGE_INVITE,
  FORBIDDEN_FIRST_OPEN,
  summarizeOfferingForIntro,
  composeOpenerIdentity,
  composeBusinessAssistantIntro,
  previewBusinessAssistantIntro,
  introLooksValid,
  shortenNotice,
  isDefaultShopName,
  isDefaultAgentName,
};
