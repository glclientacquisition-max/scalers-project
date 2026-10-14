// TextSMS low-credit monitor. Mirrors the SautiKit wallet probe
// (src/sautikit/walletProbe.js): a timed balance probe (getbalance only,
// never sends an SMS), a state for /healthz and Admin billing, and a
// platform ops alert (Resend email + Telegram) latched per level until
// recovery and rate-limited by VOICE_PLATFORM_OPS_COOLDOWN_MS.
// Prod and staging share one TextSMS account, so staging should run with
// VOICE_PLATFORM_OPS_DRY_RUN=true (log only).

const { probeSmsCredentials, getSmsStatus, onSmsCreditExhausted } = require('./sms');
const { dispatchToStaff } = require('./recipients');
const { platformOpsRecipients } = require('./platformOpsRecipients');
const { opsCooldownMs } = require('./platformOpsAlert');

const DEFAULT_INTERVAL_MS = 45 * 60 * 1000;
const MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const SEVERITY = { unknown: 0, ok: 0, warn: 1, critical: 2, exhausted: 3 };

let state = {
  state: 'unknown',
  balance: null,
  checkedAt: null,
  runwayDays: null,
  exhaustedBy402At: null,
};
/** @type {Array<{ at: number, balance: number }>} */
let samples = [];
let alertedLevel = 'ok';
let alertedAt = 0;
let lastAttemptAt = 0;
let lastAttemptLevel = null;
let dispatchOverride = null;
let telegramOverride = null;
let unsubscribe = null;

function numEnv(name, fallback) {
  const n = Number(process.env[name]);
  return process.env[name] != null && process.env[name] !== '' && Number.isFinite(n) ? n : fallback;
}

function smsCreditThresholds() {
  const warnBelow = numEnv('SMS_CREDIT_WARN_BELOW', 100);
  const criticalAtOrBelow = numEnv('SMS_CREDIT_CRITICAL_AT', 20);
  return { warnBelow, criticalAtOrBelow };
}

function smsCreditProbeIntervalMs() {
  const n = numEnv('SMS_CREDIT_PROBE_MS', DEFAULT_INTERVAL_MS);
  if (!(n > 0)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, n));
}

/** Pure: balance → ok | warn | critical | exhausted | unknown. */
function classifySmsCredit(balance, thresholds = smsCreditThresholds()) {
  if (balance == null || !Number.isFinite(Number(balance))) return 'unknown';
  const b = Number(balance);
  if (b <= 0) return 'exhausted';
  if (b <= thresholds.criticalAtOrBelow) return 'critical';
  if (b < thresholds.warnBelow) return 'warn';
  return 'ok';
}

/** Pure: units/day burn from samples (drops on top-up reset the window). */
function estimateRunwayDays(history, balance) {
  if (balance == null) return null;
  if (balance <= 0) return 0;
  const rows = [...history].sort((a, b) => a.at - b.at);
  // Keep only the trailing non-increasing run (a top-up starts a new window).
  let start = rows.length - 1;
  while (start > 0 && rows[start - 1].balance >= rows[start].balance) start -= 1;
  const win = rows.slice(start);
  if (win.length < 2) return null;
  const used = win[0].balance - win[win.length - 1].balance;
  const days = (win[win.length - 1].at - win[0].at) / 86_400_000;
  if (!(used > 0) || !(days > 0)) return null;
  return Math.round((balance / (used / days)) * 10) / 10;
}

function isDryRun() {
  return String(process.env.VOICE_PLATFORM_OPS_DRY_RUN || '').toLowerCase() === 'true';
}

function alertBody(level, detail) {
  const lines = [
    level === 'exhausted'
      ? 'Scalers TextSMS credits are exhausted. Owner/caller SMS are failing (falling back to WhatsApp/email/Desk).'
      : `Scalers TextSMS credits are low (${level}).`,
    `Balance: ${detail.balance != null ? `${detail.balance} units` : 'unknown'}`,
  ];
  if (detail.runwayDays != null) lines.push(`Runway: ~${detail.runwayDays} days`);
  if (detail.reason) lines.push(`Detail: ${String(detail.reason).slice(0, 160)}`);
  lines.push('Shared account (prod + staging). Top up at TextSMS. Check /admin/billing and Voice GET /healthz.');
  return lines.join('\n');
}

async function sendTelegram(text) {
  if (telegramOverride) return telegramOverride(text);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, reason: 'telegram_not_configured' };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  return { ok: res.ok, status: res.status };
}

async function maybeAlert(level, detail) {
  if (SEVERITY[level] === 0) {
    alertedLevel = 'ok';
    alertedAt = 0;
    lastAttemptAt = 0;
    lastAttemptLevel = null;
    return { ok: false, reason: 'healthy' };
  }
  if (SEVERITY[level] <= SEVERITY[alertedLevel]) return { ok: false, reason: 'already_alerted' };
  const now = Date.now();
  // Same rate limit as platform ops: a failed attempt is retried only after
  // VOICE_PLATFORM_OPS_COOLDOWN_MS; a worse level always alerts once.
  if (lastAttemptAt && now - lastAttemptAt < opsCooldownMs() && level === lastAttemptLevel) {
    return { ok: false, reason: 'cooldown' };
  }
  lastAttemptAt = now;
  lastAttemptLevel = level;
  const body = alertBody(level, detail);
  const subject =
    level === 'exhausted' ? 'Scalers TextSMS credits exhausted' : `Scalers TextSMS credits ${level}`;

  if (isDryRun()) {
    alertedLevel = level;
    alertedAt = now;
    console.warn(`[sms-credit] DRY_RUN level=${level} body=${JSON.stringify(body)}`);
    return { ok: true, channel: 'dry_run' };
  }

  const channels = [];
  try {
    const tg = await sendTelegram(body);
    if (tg?.ok) channels.push('telegram');
  } catch (err) {
    console.warn('[sms-credit] telegram failed:', err?.message || err);
  }
  try {
    const { recipients } = await platformOpsRecipients();
    if (recipients.length) {
      const dispatch = dispatchOverride || dispatchToStaff;
      const { sent } = await dispatch({
        recipients,
        body,
        subject,
        lead: { reason: 'Platform SMS credits low', businessName: null },
        // Never alert about SMS credits over SMS.
        channels: { sms: false, whatsapp: false, email: true },
        ledger: { kind: 'platform_ops_sms_credit' },
      });
      if (sent.some((row) => row.channel)) channels.push('email');
    }
  } catch (err) {
    console.warn('[sms-credit] email failed:', err?.message || err);
  }
  if (!channels.length) return { ok: false, reason: 'not_sent' };
  alertedLevel = level;
  alertedAt = now;
  console.error(`[sms-credit] alerted level=${level} channels=${channels.join(',')}`);
  return { ok: true, channels };
}

function applyBalance(balance, checkedAt) {
  const at = Date.parse(checkedAt) || Date.now();
  if (balance != null) {
    samples.push({ at, balance });
    const cutoff = at - 7 * 86_400_000;
    samples = samples.filter((s) => s.at >= cutoff).slice(-200);
  }
  const level = classifySmsCredit(balance);
  state = {
    state: level,
    balance,
    checkedAt,
    runwayDays: estimateRunwayDays(samples, balance),
    exhaustedBy402At: level === 'exhausted' ? state.exhaustedBy402At : null,
  };
  return level;
}

/** Balance probe (no SMS sent) + classify + alert. */
async function runSmsCreditCheck(opts = {}) {
  const probe = await probeSmsCredentials({ force: true, fetchImpl: opts.fetchImpl });
  if (!probe.configured || !probe.verified || probe.balance == null) {
    state = { ...state, state: 'unknown', checkedAt: probe.checkedAt };
    return { ok: false, reason: probe.configured ? 'probe_failed' : 'not_configured', sms: getSmsCreditHealth() };
  }
  const level = applyBalance(probe.balance, probe.checkedAt);
  const alert = await maybeAlert(level, { balance: probe.balance, runwayDays: state.runwayDays });
  return { ok: true, level, alert, sms: getSmsCreditHealth() };
}

/** Called on a TextSMS 402 / code 1008 send failure. */
function noteSmsCreditExhausted(detail = {}) {
  const checkedAt = new Date().toISOString();
  state = { ...state, state: 'exhausted', balance: 0, checkedAt, runwayDays: 0, exhaustedBy402At: checkedAt };
  return maybeAlert('exhausted', {
    balance: 0,
    reason: `send http=${detail.status ?? 'n/a'} code=${detail.code ?? 'n/a'} ${detail.description || ''}`.trim(),
  }).catch((err) => console.warn('[sms-credit] alert error:', err?.message || err));
}

/** /healthz block. No secrets. */
function getSmsCreditHealth() {
  const sms = getSmsStatus();
  return {
    configured: Boolean(sms.configured),
    verified: sms.verified ?? null,
    balance: state.balance ?? sms.balance ?? null,
    checkedAt: state.checkedAt ?? sms.checkedAt ?? null,
    state: state.state,
    runwayDays: state.runwayDays,
    thresholds: smsCreditThresholds(),
    probeIntervalMs: smsCreditProbeIntervalMs(),
  };
}

function startSmsCreditProbe() {
  if (String(process.env.SMS_CREDIT_PROBE || 'on').toLowerCase() === 'off') return null;
  if (!unsubscribe) unsubscribe = onSmsCreditExhausted((d) => void noteSmsCreditExhausted(d));
  const tick = () => {
    void runSmsCreditCheck().catch((err) => {
      console.warn('[sms-credit] probe error:', err?.message || err);
    });
  };
  tick();
  const timer = setInterval(tick, smsCreditProbeIntervalMs());
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/** Tests only. */
function resetSmsCreditMonitor() {
  state = { state: 'unknown', balance: null, checkedAt: null, runwayDays: null, exhaustedBy402At: null };
  samples = [];
  alertedLevel = 'ok';
  alertedAt = 0;
  lastAttemptAt = 0;
  lastAttemptLevel = null;
  dispatchOverride = null;
  telegramOverride = null;
}

/** Tests only. */
function setSmsCreditAlertTransports({ dispatch, telegram } = {}) {
  dispatchOverride = dispatch || null;
  telegramOverride = telegram || null;
}

module.exports = {
  classifySmsCredit,
  estimateRunwayDays,
  smsCreditThresholds,
  smsCreditProbeIntervalMs,
  runSmsCreditCheck,
  noteSmsCreditExhausted,
  getSmsCreditHealth,
  startSmsCreditProbe,
  resetSmsCreditMonitor,
  setSmsCreditAlertTransports,
};
