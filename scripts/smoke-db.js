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
 * Pick a tenant without maybeSingle() on a non-unique filter.
 * Staging often has several is_active rows; maybeSingle then errors, the
 * script ignores it, and insert collides on tenants_sautikit_virtual_number_key.
 */
async function ensureTenant(supabase) {
  const { data: byDid, error: byDidError } = await supabase
    .from('tenants')
    .select('id')
    .eq('sautikit_virtual_number', SMOKE_DID)
    .maybeSingle();
  if (byDidError) throw byDidError;
  if (byDid?.id) return byDid.id;

  const { data: active, error: activeError } = await supabase
    .from('tenants')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1);
  if (activeError) throw activeError;
  if (active?.[0]?.id) return active[0].id;

  const { data, error } = await supabase
    .from('tenants')
    .insert({
      business_name: 'Phase1 Smoke Tenant',
      sautikit_virtual_number: SMOKE_DID,
      whatsapp_notification_number: '+254700000000',
      is_active: true,
    })
    .select('id')
    .single();
  if (error) throw error;
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

module.exports = { ensureTenant, SMOKE_DID };

if (require.main === module) {
  main().catch((err) => {
    console.error('✗ smoke-db failed:', err?.message || err);
    process.exit(1);
  });
}
