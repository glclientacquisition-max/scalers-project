// src/db.js
// Supabase persistence for calls, transcripts, and call-recordings storage.
// Keeps the same function names as the former SQLite db.js so server.js
// only needs async/await at call sites.

const { supabase } = require('./lib/supabaseClient');

const RECORDINGS_BUCKET = process.env.SUPABASE_RECORDINGS_BUCKET || 'call-recordings';
const DEFAULT_TENANT_ID = process.env.TENANT_ID || null;

function throwIfError(context, error) {
  if (error) {
    const err = new Error(`[db] ${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
}

async function resolveTenantId({ toNumber, tenantId }) {
  if (tenantId) return tenantId;
  if (DEFAULT_TENANT_ID) return DEFAULT_TENANT_ID;
  if (!toNumber) return null;

  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('did_e164', toNumber)
    .maybeSingle();

  throwIfError('resolveTenantId', error);
  return data?.id || null;
}

async function upsertCall({ callSid, fromNumber, toNumber, tenantId, provider = 'twilio' }) {
  const resolvedTenantId = await resolveTenantId({ toNumber, tenantId });

  const row = {
    call_sid: callSid,
    from_number: fromNumber || null,
    to_number: toNumber || null,
    provider,
    status: 'in_progress',
    updated_at: new Date().toISOString(),
  };

  if (resolvedTenantId) {
    row.tenant_id = resolvedTenantId;
  }

  const { data, error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'call_sid' })
    .select('*')
    .single();

  throwIfError('upsertCall', error);
  return data;
}

async function saveCallerInfo({ callSid, name, reason }) {
  const { data, error } = await supabase
    .from('calls')
    .update({
      name,
      reason,
      updated_at: new Date().toISOString(),
    })
    .eq('call_sid', callSid)
    .select('*')
    .maybeSingle();

  throwIfError('saveCallerInfo', error);
  return data;
}

async function appendTranscript({ callSid, transcript }) {
  const call = await getCall(callSid);
  if (!call) {
    console.warn(`[db] appendTranscript: no call row for ${callSid}`);
    return null;
  }

  const payload = {
    call_id: call.id,
    call_sid: callSid,
    content: transcript,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('transcripts')
    .upsert(payload, { onConflict: 'call_id' })
    .select('*')
    .maybeSingle();

  throwIfError('appendTranscript', error);
  return data;
}

async function getCall(callSid) {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('call_sid', callSid)
    .maybeSingle();

  throwIfError('getCall', error);
  return data;
}

async function markWhatsappSent(callSid) {
  const { data, error } = await supabase
    .from('calls')
    .update({
      whatsapp_sent: true,
      updated_at: new Date().toISOString(),
    })
    .eq('call_sid', callSid)
    .eq('whatsapp_sent', false)
    .select('call_sid')
    .maybeSingle();

  throwIfError('markWhatsappSent', error);
  return Boolean(data);
}

/**
 * Download a remote recording (e.g. Twilio) and upload it to the
 * call-recordings Supabase Storage bucket. Returns a durable path + signed URL.
 */
async function uploadRecordingBuffer({
  callSid,
  recordingSid,
  buffer,
  contentType = 'audio/mpeg',
  extension = 'mp3',
}) {
  const objectPath = `${callSid}/${recordingSid || Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      upsert: true,
    });

  throwIfError('uploadRecordingBuffer', uploadError);

  // 7-day signed URL for WhatsApp / dashboard playback (private bucket).
  const { data: signed, error: signError } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .createSignedUrl(objectPath, 60 * 60 * 24 * 7);

  throwIfError('createSignedUrl', signError);

  return {
    recordingPath: objectPath,
    recordingUrl: signed?.signedUrl || null,
  };
}

/**
 * Attach a recording to the call row. Prefer uploading bytes to Storage when
 * sourceUrl is provided (downloads via optional basic auth for Twilio).
 * Falls back to storing sourceUrl directly if download/upload fails.
 */
async function attachRecording({
  callSid,
  recordingUrl,
  recordingSid,
  sourceUrl,
  authHeader,
}) {
  let finalUrl = recordingUrl || sourceUrl || null;
  let recordingPath = null;

  const downloadUrl = sourceUrl || recordingUrl;
  if (downloadUrl) {
    try {
      const headers = {};
      if (authHeader) headers.Authorization = authHeader;

      const response = await fetch(downloadUrl, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} downloading recording`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const uploaded = await uploadRecordingBuffer({
        callSid,
        recordingSid,
        buffer,
        contentType: response.headers.get('content-type') || 'audio/mpeg',
      });
      finalUrl = uploaded.recordingUrl || finalUrl;
      recordingPath = uploaded.recordingPath;
    } catch (err) {
      console.warn(
        `[db] attachRecording: Storage upload failed for ${callSid}, keeping provider URL:`,
        err?.message || err
      );
    }
  }

  const update = {
    recording_url: finalUrl,
    recording_sid: recordingSid || null,
    status: 'complete',
    updated_at: new Date().toISOString(),
  };

  // recording_path is optional — only set when the column exists / upload succeeded.
  if (recordingPath) {
    update.recording_path = recordingPath;
  }

  let { data, error } = await supabase
    .from('calls')
    .update(update)
    .eq('call_sid', callSid)
    .select('*')
    .maybeSingle();

  // If live schema lacks recording_path, retry without it.
  if (error && recordingPath && /recording_path/i.test(error.message || '')) {
    delete update.recording_path;
    ({ data, error } = await supabase
      .from('calls')
      .update(update)
      .eq('call_sid', callSid)
      .select('*')
      .maybeSingle());
  }

  throwIfError('attachRecording', error);
  return data;
}

module.exports = {
  upsertCall,
  saveCallerInfo,
  appendTranscript,
  attachRecording,
  uploadRecordingBuffer,
  getCall,
  markWhatsappSent,
  RECORDINGS_BUCKET,
};
