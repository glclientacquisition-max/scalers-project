// Scalers platform ops list (not tenant team_directory).
//
// Source of truth is Super Admin: public.platform_ops_settings (singleton id=1),
// column `people` jsonb [{id, name, phone, email}] with `emails` text[] as the
// older mirror (docs/supabase/platform_ops_notices.sql + platform_ops_people.sql).
// Fallback: SCALERS_OPS_ALERT_EMAILS env when the table is missing, empty, or the
// read fails. Email only for now: phones (Admin or SCALERS_OPS_ALERT_PHONES) are
// ignored so platform alerts never go out by SMS or WhatsApp.

const CACHE_MS_DEFAULT = 3 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @type {{ at: number, emails: string[], source: string } | null} */
let cache = null;
/** @type {null | (() => Promise<{ data: any, error: any }>)} */
let loaderOverride = null;

function splitEnvList(raw) {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeEmails(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const email = String(raw || '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Same rule as Desk loadOpsSettings: people[].email first, else emails[]. */
function emailsFromSettingsRow(row) {
  if (!row || typeof row !== 'object') return [];
  const people = Array.isArray(row.people) ? row.people : [];
  const fromPeople = normalizeEmails(
    people.map((p) => (p && typeof p === 'object' ? p.email : ''))
  );
  if (fromPeople.length) return fromPeople;
  return normalizeEmails(Array.isArray(row.emails) ? row.emails : []);
}

function envEmails(env = process.env) {
  return normalizeEmails(
    splitEnvList(env.SCALERS_OPS_ALERT_EMAILS || env.SCALERS_OPS_ALERT_EMAIL || '')
  );
}

function cacheMs(env = process.env) {
  const n = Number(env.VOICE_PLATFORM_OPS_RECIPIENTS_CACHE_MS);
  return Number.isFinite(n) && n >= 0 ? n : CACHE_MS_DEFAULT;
}

async function defaultLoader() {
  // Lazy, and only with Supabase env: the shared client exits the process when
  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing (unit tests, scripts).
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('supabase not configured');
  }
  const { supabase } = require('../lib/supabaseClient');
  return supabase
    .from('platform_ops_settings')
    .select('emails, people')
    .eq('id', 1)
    .maybeSingle();
}

function toRecipients(emails) {
  return emails.map((email) => ({
    name: 'Scalers ops',
    role: '',
    phone: '',
    email,
    receives_escalation: false,
    receives_inbox: false,
    receives_ops: true,
  }));
}

/**
 * Admin ops emails, cached a few minutes. Never throws.
 *
 * @param {{ env?: NodeJS.ProcessEnv, now?: number, force?: boolean }} [opts]
 * @returns {Promise<{ recipients: object[], emails: string[], source: 'admin'|'env'|'none', adminError?: string }>}
 */
async function platformOpsRecipients(opts = {}) {
  const env = opts.env || process.env;
  const now = opts.now ?? Date.now();
  if (!opts.force && cache && now - cache.at < cacheMs(env)) {
    return { recipients: toRecipients(cache.emails), emails: cache.emails, source: cache.source };
  }

  let adminEmails = [];
  let adminError;
  try {
    const { data, error } = await (loaderOverride || defaultLoader)();
    if (error) throw error;
    adminEmails = emailsFromSettingsRow(data);
  } catch (err) {
    adminError = String(err?.message || err).slice(0, 200);
    console.warn(
      `[platform-ops] Admin ops recipients unreadable (platform_ops_settings): ${adminError}. Using SCALERS_OPS_ALERT_EMAILS fallback.`
    );
  }

  let emails = adminEmails;
  let source = 'admin';
  if (!emails.length) {
    emails = envEmails(env);
    source = emails.length ? 'env' : 'none';
  }
  if (!emails.length) {
    console.error(
      '[platform-ops] ops alert list is EMPTY: add an email under Super Admin > Platform > Escalate (platform_ops_settings.people) or set SCALERS_OPS_ALERT_EMAILS. Alerts will reach nobody.'
    );
  }

  cache = { at: now, emails, source };
  const out = { recipients: toRecipients(emails), emails, source };
  if (adminError) out.adminError = adminError;
  return out;
}

/** Tests only. */
function setPlatformOpsRecipientsLoader(fn) {
  loaderOverride = fn;
  cache = null;
}

/** Tests only. */
function resetPlatformOpsRecipientsCache() {
  cache = null;
}

module.exports = {
  platformOpsRecipients,
  emailsFromSettingsRow,
  envEmails,
  splitEnvList,
  setPlatformOpsRecipientsLoader,
  resetPlatformOpsRecipientsCache,
};
