#!/usr/bin/env node
// Smoke-test Supabase calls / transcripts / storage against the live schema.
// Usage: node scripts/smoke-db.js

try {
  require('dotenv').config();
} catch {
  // Optional; CI and local installs have dotenv. Unit tests may not.
}

const SMOKE_DID = '+254200000001';

/**
 * Staging smoke writes go to ONE dedicated tenant only: Test Archive Co.
 * Never fall back to "the first active tenant" (that was Done and Dusted on
 * staging, so every push to main wrote a SMOKE_ call into a real-looking
 * tenant, once mid-call). Never insert a tenant. Override with SMOKE_TENANT_ID.
 */
const SMOKE_TENANT_ID = '51a6c7c6-72f9-43f7-b6c2-942960029cca';

async function ensureTenant(supabase, tenantId = process.env.SMOKE_TENANT_ID || SMOKE_TENANT_ID) {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('id', tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    throw new Error(`smoke tenant ${tenantId} not found; refusing to write into any other tenant`);
  }
  return data.id;
}

async function main() {
  const { supabase } = require('../src/lib/supabaseClient');
  const db = require('../src/db');

  const tenantId = await ensureTenant(supabase);
  process.env.TENANT_ID = tenantId;
  console.log('tenant:', tenantId);

  const callSid = `SMOKE_${Date.now()}`;

  console.log('upsertCall…');
  const call = await db.upsertCall({
    callSid,
    fromNumber: '+254700000001',
    toNumber: SMOKE_DID,
    tenantId,
    provider: 'twilio',
  });
  console.log('  call id:', call.id);

  console.log('saveCallerInfo…');
  await db.saveCallerInfo({
    callSid,
    name: 'Smoke Test',
    reason: 'Verify Supabase Phase 1',
  });

  console.log('appendTranscript…');
  await db.appendTranscript({
    callSid,
    transcript: 'Caller: Hello\nAgent: Hi there',
  });

  console.log('uploadRecordingBuffer…');
  const tinyMp3 = Buffer.from('ID3', 'utf8');
  const uploaded = await db.uploadRecordingBuffer({
    callSid,
    recordingSid: 'SMOKE_REC',
    buffer: tinyMp3,
    contentType: 'audio/mpeg',
  });
  console.log('  path:', uploaded.recordingPath);

  console.log('attachRecording…');
  await db.attachRecording({
    callSid,
    recordingSid: 'SMOKE_REC',
    recordingUrl: uploaded.recordingUrl,
  });

  const finalCall = await db.getCall(callSid);
  console.log('getCall:', {
    call_sid: finalCall.call_sid,
    name: finalCall.name,
    reason: finalCall.reason,
    recording_url: Boolean(finalCall.recording_url),
    status: finalCall.status,
    whatsapp_sent: finalCall.whatsapp_sent,
  });

  const marked = await db.markWhatsappSent(callSid);
  console.log('markWhatsappSent:', marked);

  console.log('✓ smoke-db passed');
}

module.exports = { ensureTenant, SMOKE_DID, SMOKE_TENANT_ID };

if (require.main === module) {
  main().catch((err) => {
    console.error('✗ smoke-db failed:', err?.message || err);
    process.exit(1);
  });
}
