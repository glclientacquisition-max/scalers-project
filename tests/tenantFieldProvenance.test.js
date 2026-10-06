#!/usr/bin/env node
/** Guards GIGO P0 provenance RPC client exports (no live Supabase required). */
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'smoke-test-key';

const assert = require('assert');
const db = require('../src/db');

assert.strictEqual(typeof db.getTenantCompletenessScore, 'function');
assert.strictEqual(typeof db.getTenantHoldGate, 'function');
assert.strictEqual(typeof db.listTenantFieldMeta, 'function');
assert.strictEqual(typeof db.upsertTenantFieldMeta, 'function');
assert.strictEqual(typeof db.confirmTenantField, 'function');

console.log('tenantFieldProvenance exports ok');
