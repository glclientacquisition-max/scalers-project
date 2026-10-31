'use strict';

// Browser demo flags. Every flag is on only when it equals the exact
// string `on`. Unset, `true`, `On`, `1`, and anything else mean off.
// The demo never dials and never names a real tenant or the prod line.

const TENANT_IDS = Object.freeze({
  home: 'demo_home',
  shop: 'demo_shop',
  other: 'demo_other',
});

const DEMO_TENANT_IDS = new Set(Object.values(TENANT_IDS));

// Prod Aris. A demo request that names this number is rejected.
const ARIS_DID_DIGITS = '709221536';

const TOKEN_TTL_SEC = 60;
const MAX_SEC = 180;
const DEFAULT_SESSIONS_PER_VISITOR = 1;
const DEFAULT_MAX_CONCURRENT = 5;

function processDemoEnv() {
  return {
    DEMO_ENABLED: process.env.DEMO_ENABLED,
    DEMO_ALLOWED_ORIGINS: process.env.DEMO_ALLOWED_ORIGINS,
    DEMO_MAX_CONCURRENT: process.env.DEMO_MAX_CONCURRENT,
    DEMO_SESSIONS_PER_VISITOR: process.env.DEMO_SESSIONS_PER_VISITOR,
    DEMO_VISITOR_PERSIST: process.env.DEMO_VISITOR_PERSIST,
    VOICE_INTERNAL_SECRET: process.env.VOICE_INTERNAL_SECRET,
    DEMO_TOKEN_SECRET: process.env.DEMO_TOKEN_SECRET,
    DEMO_IP_SALT: process.env.DEMO_IP_SALT,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    DEMO_PUBLIC_BASE_URL: process.env.DEMO_PUBLIC_BASE_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
    DEMO_OPUS: process.env.DEMO_OPUS,
    DEMO_RECORD: process.env.DEMO_RECORD,
    DEMO_DAILY_CAP_USD: process.env.DEMO_DAILY_CAP_USD,
    DEMO_MONTHLY_CAP_USD: process.env.DEMO_MONTHLY_CAP_USD,
    DEMO_SPEND_PERSIST: process.env.DEMO_SPEND_PERSIST,
  };
}

function spendPersistOn(env = process.env) {
  return env.DEMO_SPEND_PERSIST === 'on';
}

function visitorPersistOn(env = process.env) {
  return env.DEMO_VISITOR_PERSIST === 'on';
}

function moneyCap(env, name, dflt) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === '') return dflt;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0 || n > 100000) return dflt;
  return n;
}

function dailyCapUsd(env = process.env) {
  return moneyCap(env, 'DEMO_DAILY_CAP_USD', 2);
}

function monthlyCapUsd(env = process.env) {
  return moneyCap(env, 'DEMO_MONTHLY_CAP_USD', 50);
}

function demoEnabled(env = process.env) {
  return env.DEMO_ENABLED === 'on';
}

function demoOpusOn(env = process.env) {
  return env.DEMO_OPUS === 'on';
}

// Read for logs only. The demo session does not record, even when this is `on`.
function demoRecordOn(env = process.env) {
  return env.DEMO_RECORD === 'on';
}

function allowedOrigins(env = process.env) {
  return String(env.DEMO_ALLOWED_ORIGINS || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function originAllowed(origin, env = process.env) {
  const value = String(origin || '').trim();
  if (!value) return false;
  return allowedOrigins(env).includes(value);
}

function maxConcurrent(env = process.env) {
  const raw = env.DEMO_MAX_CONCURRENT;
  if (raw == null || String(raw).trim() === '') return DEFAULT_MAX_CONCURRENT;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > 100) return DEFAULT_MAX_CONCURRENT;
  return n;
}

function boundedInt(raw, fallback, max) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > max) return fallback;
  return n;
}

function sessionsPerVisitor(env = process.env) {
  return boundedInt(env.DEMO_SESSIONS_PER_VISITOR, DEFAULT_SESSIONS_PER_VISITOR, 100);
}

function mentionsAris(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.includes(ARIS_DID_DIGITS);
}

module.exports = {
  TENANT_IDS,
  DEMO_TENANT_IDS,
  ARIS_DID_DIGITS,
  TOKEN_TTL_SEC,
  MAX_SEC,
  DEFAULT_SESSIONS_PER_VISITOR,
  DEFAULT_MAX_CONCURRENT,
  processDemoEnv,
  demoEnabled,
  demoOpusOn,
  demoRecordOn,
  spendPersistOn,
  visitorPersistOn,
  dailyCapUsd,
  monthlyCapUsd,
  allowedOrigins,
  originAllowed,
  maxConcurrent,
  sessionsPerVisitor,
  mentionsAris,
};
