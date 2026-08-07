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
    /\b(closed|close early|closing early|not open|shut|maandamano|no operations|off today)\b/i.test(
      item.text
    )
  );
}

/** First active closure-style bulletin text, if any. */
function bulletinClosureNotice(raw, now = new Date()) {
  const items = activeBulletinItems(raw, now);
  const hit = items.find((item) =>
    /\b(closed|close early|closing early|not open|shut|maandamano|no operations|off today)\b/i.test(
      item.text
    )
  );
  return hit ? hit.text : null;
}

/**
 * Prompt block for CONTEXT HEADER. Empty string if nothing active.
 */
function formatBulletinForPrompt(raw, now = new Date()) {
  const items = activeBulletinItems(raw, now);
  if (!items.length) return '';

  const lines = items.map((item) => {
    const until = formatEndLabel(item.ends_at, now);
    return `- Fact to tell callers: "${item.text}" [internal expiry: ${until} — do not read this expiry aloud]`;
  });

  return `DAILY BULLETIN (highest priority facts for this call — override menu/FAQs if they conflict):
${lines.join('\n')}
SPEAKING RULES FOR BULLETIN:
- When the caller asks about these topics (or if a bulletin says you are closed today), tell them the Fact text in natural words.
- Speak the owner's Fact text. Do NOT invent or speak the expiry/clear time unless the caller asks how long this lasts.
- Do not say the word "bulletin". Do not say "until tonight" / clock times from the internal expiry.
- Do not offer something a bulletin says is unavailable.`;
}

module.exports = {
  normalizeBulletin,
  activeBulletinItems,
  formatBulletinForPrompt,
  formatEndLabel,
  bulletinImpliesClosed,
  bulletinClosureNotice,
};
