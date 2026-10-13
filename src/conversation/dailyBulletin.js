// Daily bulletin helpers — temporary high-priority facts for live calls.

function asArray(raw) {
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

/** EAT (= UTC+3) instant as Date for comparisons. */
function eatNow(date = new Date()) {
  return new Date(date.getTime() + 3 * 60 * 60 * 1000);
}

function parseInstant(raw) {
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize bulletin rows from DB.
 * @returns {Array<{id:string,text:string,active:boolean,starts_at:string|null,ends_at:string|null,created_at:string|null}>}
 */
function normalizeBulletin(raw) {
  return asArray(raw)
    .map((row, index) => {
      const text = String(row?.text || '').trim();
      if (!text) return null;
      const active = row?.active !== false;
      return {
        id: String(row?.id || `item-${index}`),
        text: text.slice(0, 160),
        announce: ['always', 'ask'].includes(String(row?.announce || '').toLowerCase())
          ? String(row.announce).toLowerCase()
          : null,
        active,
        starts_at: row?.starts_at ? String(row.starts_at) : null,
        ends_at: row?.ends_at ? String(row.ends_at) : null,
        created_at: row?.created_at ? String(row.created_at) : null,
      };
    })
    .filter(Boolean);
}

/**
 * Items that should influence this call.
 * @param {unknown} raw
 * @param {Date} [now]
 */
function activeBulletinItems(raw, now = new Date()) {
  const items = normalizeBulletin(raw);
  return items.filter((item) => {
    if (!item.active) return false;
    const start = parseInstant(item.starts_at);
    const end = parseInstant(item.ends_at);
    if (start && now < start) return false;
    if (end && now > end) return false;
    return true;
  });
}

function formatEndLabel(endsAt, now = new Date()) {
  const end = parseInstant(endsAt);
  if (!end) return 'until cleared';
  const eatEnd = new Date(end.getTime() + 3 * 60 * 60 * 1000);
  const eat = eatNow(now);
  const sameDay =
    eatEnd.getUTCFullYear() === eat.getUTCFullYear() &&
    eatEnd.getUTCMonth() === eat.getUTCMonth() &&
    eatEnd.getUTCDate() === eat.getUTCDate();
  if (sameDay && eatEnd.getUTCHours() >= 23 && eatEnd.getUTCMinutes() >= 50) {
    return 'until tonight EAT';
  }
  const hour = eatEnd.getUTCHours();
  const min = String(eatEnd.getUTCMinutes()).padStart(2, '0');
  const hour12 = ((hour + 11) % 12) + 1;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const day = eatEnd.toLocaleDateString('en-KE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `until ${day} ${hour12}:${min} ${ampm} EAT`;
}

/**
 * True when an active bulletin means the business is closed / not operating today.
 */
function bulletinImpliesClosed(raw, now = new Date()) {
  const items = activeBulletinItems(raw, now);
  return items.some((item) =>
    /\b(closed|not open|shut|maandamano|no operations|off today)\b/i.test(
      item.text
    )
  );
}

/** First active closure-style bulletin text, if any. */
function bulletinClosureNotice(raw, now = new Date()) {
  const items = activeBulletinItems(raw, now);
  const hit = items.find((item) =>
    /\b(closed|not open|shut|maandamano|no operations|off today)\b/i.test(
      item.text
    )
  );
  return hit ? hit.text : null;
}

/**
 * Classify whether a bulletin is operational (hours/closure/delay) vs promo/offer.
 * Promos must not be volunteered on unrelated turns.
 */
function bulletinKind(text) {
  const value = String(text || '');
  if (
    /\b(closed|not open|shut|maandamano|no operations|off today|closing early|open late|delay|delayed|power|outage|strike)\b/i.test(
      value
    )
  ) {
    return 'operational';
  }
  if (
    /\b(offer|promo|promotion|deal|discount|sale|%|ksh|kes|bob|free|buy\s*\d|go for|\d+\s*(books?|items?)\s*(at|for))\b/i.test(
      value
    ) ||
    /\bnotify customers?\b/i.test(value)
  ) {
    return 'promo';
  }
  return 'notice';
}

/**
 * Prompt block for CONTEXT HEADER. Empty string if nothing active.
 */
function formatBulletinForPrompt(raw, now = new Date()) {
  const items = activeBulletinItems(raw, now);
  if (!items.length) return '';

  // The owner's choice decides. Updates posted before the choice existed fall back
  // to the old reading: closures are told, everything else waits for the topic.
  const tagOf = (item) => {
    if (item.announce === 'always') return 'tell every caller';
    if (item.announce === 'ask') return 'only if asked';
    return bulletinKind(item.text) === 'operational' ? 'tell every caller' : 'only if asked';
  };
  const lines = items.map((item) => {
    const until = formatEndLabel(item.ends_at, now);
    return `- [${tagOf(item)}] Fact: "${item.text}" [internal expiry: ${until} — do not read this expiry aloud]`;
  });

  return `TODAY'S UPDATES FROM THE OWNER (override conflicting menu/FAQs only when the fact applies):
${lines.join('\n')}
SPEAKING RULES FOR UPDATES:
- [tell every caller]: say it in your first reply, in natural words, once. Do not repeat it later unless asked.
- [only if asked]: share it only when the caller asks about that topic. Never volunteer it.
- Speak the owner's Fact text. Do NOT speak the expiry or clear time unless the caller asks how long this lasts.
- Do not say the word "bulletin" or "update". Do not say "until tonight" / clock times from the internal expiry.
- Do not offer something an update says is unavailable.
- After stating a closure / interruption fact, NEVER go silent. In the SAME turn, say you can still help (or take a message) and ask one short next question (what they need).
- Example shape: "<fact in natural words>. Even so, I can still help. What do you need?"`;
}

module.exports = {
  normalizeBulletin,
  activeBulletinItems,
  formatBulletinForPrompt,
  formatEndLabel,
  bulletinImpliesClosed,
  bulletinClosureNotice,
  bulletinKind,
};
