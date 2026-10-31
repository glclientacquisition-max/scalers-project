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
const DAILY_SESSION_LIMIT = 3;
const DEFAULT_MAX_CONCURRENT = 5;

function processDemoEnv() {
  return {
    DEMO_ENABLED: process.env.DEMO_ENABLED,
    DEMO_ALLOWED_ORIGINS: process.env.DEMO_ALLOWED_ORIGINS,
    DEMO_MAX_CONCURRENT: process.env.DEMO_MAX_CONCURRENT,
    DEMO_TOKEN_SECRET: process.env.DEMO_TOKEN_SECRET,
    DEMO_IP_SALT: process.env.DEMO_IP_SALT,
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY,
    DEMO_PUBLIC_BASE_URL: process.env.DEMO_PUBLIC_BASE_URL,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL,
  };
}

function demoEnabled(env = process.env) {
  return env.DEMO_ENABLED === 'on';
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
  DAILY_SESSION_LIMIT,
  DEFAULT_MAX_CONCURRENT,
  processDemoEnv,
  demoEnabled,
  allowedOrigins,
  originAllowed,
  maxConcurrent,
  mentionsAris,
};
