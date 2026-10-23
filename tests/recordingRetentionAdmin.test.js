'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('platform ops API is admin-only and supports retention preview', () => {
  const route = read('dashboard/src/app/api/admin/platform-ops/route.ts');
  assert.match(route, /isLegacyAuthenticated/);
  assert.match(route, /recording_retention_preview/);
  // The preview is a read: served by GET, never a POST action branch (Activity records every POST branch).
  const get = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'));
  assert.match(get, /searchParams\.has\("recording_retention_preview"\)/);
  assert.doesNotMatch(route, /action === "recording_retention_preview"/);
  assert.match(route, /save_recording_retention_platform/);
  assert.match(route, /recording_retention_days/);
});

test('businesses API saves tenant recording override with audit', () => {
  const route = read('dashboard/src/app/api/admin/businesses/route.ts');
  assert.match(route, /requireAdminOperatorWrite/);
  assert.match(route, /action: "save_recording_retention"/);
  assert.match(route, /recording_retention_days_override/);
  assert.match(route, /recordAdminAction/);
});

test('admin platform form exposes recording retention control', () => {
  const form = read('dashboard/src/components/AdminPlatformOpsForm.tsx');
  assert.match(form, /Delete call recordings after/);
  assert.match(form, /recording_retention_preview/);
  assert.match(form, /ConfirmSheet/);
});

test('business detail sheet has per-tenant override', () => {
  // #787 moved per-business actions to the shop page (AdminShopPanel).
  const panel = read('dashboard/src/components/AdminShopPanel.tsx');
  assert.match(panel, /Recording retention/);
  assert.match(panel, /save_recording_retention/);
});

test('Calls page passes effective retention into CallRecording', () => {
  const page = read('dashboard/src/app/(desk)/calls/[id]/page.tsx');
  const recording = read('dashboard/src/components/CallRecording.tsx');
  assert.match(page, /effectiveRecordingRetentionForTenant/);
  assert.match(page, /effectiveRecordingRetention/);
  assert.match(recording, /effectiveRetention/);
  assert.match(recording, /recordingRetentionNote/);
});
