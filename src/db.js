// src/db.js
// Supabase persistence mapped to the live schema:
//   tenants(business_name, sautikit_virtual_number, …)
//   calls(tenant_id, caller_number, sautikit_call_sid, recording_url, summary, …)
//   transcripts(call_id, speaker, text_content, latency_ms)
//   storage bucket: call-recordings
//
// Preserves the orchestration-facing API used by server.js (async).

const { supabase } = require('./lib/supabaseClient');

const RECORDINGS_BUCKET = process.env.SUPABASE_RECORDINGS_BUCKET || 'call-recordings';
const DEFAULT_TENANT_ID = process.env.TENANT_ID || null;
const WALLET_CHARGING_ENABLED = String(process.env.WALLET_CHARGING_ENABLED || 'true').toLowerCase() !== 'false';
const WALLET_RATE_KES_PER_MINUTE = Number(process.env.WALLET_RATE_KES_PER_MINUTE || 15);

function throwIfError(context, error) {
  if (error) {
    const err = new Error(`[db] ${context}: ${error.message}`);
    err.cause = error;
    throw err;
  }
}

function parseSummary(summary) {
  if (!summary) return {};
  if (typeof summary === 'object') return summary;
  try {
    const parsed = JSON.parse(summary);
    return parsed && typeof parsed === 'object' ? parsed : { text: summary };
  } catch {
    return { text: summary };
  }
}

function serializeSummary(meta) {
  return JSON.stringify(meta || {});
}

/** Map a live `calls` row to the shape server.js historically expected from SQLite. */
function shapeCall(row) {
  if (!row) return null;
  const meta = parseSummary(row.summary);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    call_sid: row.sautikit_call_sid,
    from_number: row.caller_number,
    to_number: meta.to_number || null,
    name: meta.name || null,
    reason: meta.reason || null,
    recording_url: row.recording_url || null,
    recording_sid: meta.recording_sid || null,
    recording_path: meta.recording_path || null,
    status: row.status || null,
    whatsapp_sent: Boolean(meta.whatsapp_sent),
    escalation_sent: Boolean(meta.escalation_sent),
    escalated_to: meta.escalated_to || null,
    escalate_reason: meta.escalate_reason || null,
    escalation_notify: meta.escalation_notify || null,
    duration_seconds: row.duration_seconds ?? null,
    ai_processing_minutes: row.ai_processing_minutes ?? null,
    created_at: row.created_at,
    summary: row.summary,
    _raw: row,
  };
}

async function resolveTenantId({ toNumber, fromNumber, tenantId }) {
  if (tenantId) return tenantId;
  if (DEFAULT_TENANT_ID) return DEFAULT_TENANT_ID;

  const candidates = [toNumber, fromNumber].filter(Boolean);
  for (const candidate of candidates) {
    const { data, error } = await supabase
      .from('tenants')
      .select('id')
      .eq('sautikit_virtual_number', candidate)
      .maybeSingle();
    throwIfError('resolveTenantId(by DID)', error);
    if (data?.id) return data.id;

    // Also try digit-normalized match for +254 vs 254 variants.
    const digits = String(candidate).replace(/\D/g, '');
    if (!digits) continue;
    const { data: all, error: listError } = await supabase
      .from('tenants')
      .select('id, sautikit_virtual_number')
      .eq('is_active', true);
    throwIfError('resolveTenantId(list)', listError);
    const hit = (all || []).find(
      (row) => String(row.sautikit_virtual_number || '').replace(/\D/g, '') === digits
    );
    if (hit?.id) return hit.id;
  }

  // Fall back to the first active tenant (single-tenant deployments).
  const { data: fallback, error: fallbackError } = await supabase
    .from('tenants')
    .select('id')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  throwIfError('resolveTenantId(fallback)', fallbackError);
  if (fallback?.id) return fallback.id;

  throw new Error(
    '[db] No tenant_id available. Set TENANT_ID or create a tenants row with sautikit_virtual_number.'
  );
}

function isAssignableDid(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (s.toLowerCase().startsWith('pending:')) return false;
  // Require a plausible E.164-ish phone (digits after optional +).
  const digits = s.replace(/\D/g, '');
  return digits.length >= 9;
}

async function listActiveTenantDids() {
  const { data, error } = await supabase
    .from('tenants')
    .select('sautikit_virtual_number')
    .eq('is_active', true);
  throwIfError('listActiveTenantDids', error);
  const fromEnv = [process.env.SAUTIKIT_DID, process.env.TENANT_DID].filter(Boolean);
  const fromDb = (data || []).map((r) => r.sautikit_virtual_number).filter(isAssignableDid);
  return [...new Set([...fromDb, ...fromEnv.filter(isAssignableDid)])];
}

async function upsertCall({ callSid, fromNumber, toNumber, tenantId, provider = 'sautikit' }) {
  const resolvedTenantId = await resolveTenantId({ toNumber, fromNumber, tenantId });
  const existing = await getCall(callSid);
  const meta = existing
    ? parseSummary(existing.summary)
    : {};

  meta.provider = provider;
  if (toNumber) meta.to_number = toNumber;

  const row = {
    tenant_id: resolvedTenantId,
    caller_number: fromNumber || existing?.from_number || 'unknown',
    sautikit_call_sid: callSid,
    status: existing?.status || 'in_progress',
    summary: serializeSummary(meta),
  };

  const { data, error } = await supabase
    .from('calls')
    .upsert(row, { onConflict: 'sautikit_call_sid' })
    .select('*')
    .single();

  throwIfError('upsertCall', error);
  return shapeCall(data);
}

async function saveCallerInfo({ callSid, name, reason }) {
  const existing = await getCall(callSid);
  if (!existing) {
    throw new Error(`[db] saveCallerInfo: no call for ${callSid}`);
  }

  const meta = parseSummary(existing.summary);
  // Merge partial updates so a corrected name can overwrite without clearing reason.
  if (name != null && String(name).trim()) {
    meta.name = String(name).trim();
  }
  if (reason != null && String(reason).trim()) {
    meta.reason = String(reason).trim();
  }

  const { data, error } = await supabase
    .from('calls')
    .update({ summary: serializeSummary(meta) })
    .eq('sautikit_call_sid', callSid)
    .select('*')
    .maybeSingle();

  throwIfError('saveCallerInfo', error);
  return shapeCall(data);
}

/**
 * Replace transcript turns for a call.
 * Accepts either the legacy full-text blob ("Caller: …\\nAgent: …") or
 * an array of { speaker, text, latencyMs }.
 */
async function appendTranscript({ callSid, transcript, turns }) {
  const call = await getCall(callSid);
  if (!call) {
    console.warn(`[db] appendTranscript: no call row for ${callSid}`);
    return null;
  }

  let rows = turns;
  if (!rows) {
    rows = String(transcript || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const caller = /^Caller:\s*(.*)$/i.exec(line);
        if (caller) return { speaker: 'caller', text: caller[1] };
        const agent = /^Agent:\s*(.*)$/i.exec(line);
        if (agent) return { speaker: 'agent', text: agent[1] };
        return { speaker: 'system', text: line };
      });
  }

  // Full replace keeps the blob-style updates from server.js idempotent.
  const { error: deleteError } = await supabase
    .from('transcripts')
    .delete()
    .eq('call_id', call.id);
  throwIfError('appendTranscript(delete)', deleteError);

  if (rows.length === 0) return [];

  const payload = rows.map((turn) => ({
    call_id: call.id,
    speaker: turn.speaker,
    text_content: turn.text,
    latency_ms: turn.latencyMs ?? null,
  }));

  const { data, error } = await supabase
    .from('transcripts')
    .insert(payload)
    .select('*');

  throwIfError('appendTranscript(insert)', error);
  return data;
}

async function getCall(callSid) {
  const { data, error } = await supabase
    .from('calls')
    .select('*')
    .eq('sautikit_call_sid', callSid)
    .maybeSingle();

  throwIfError('getCall', error);
  return shapeCall(data);
}

async function markWhatsappSent(callSid) {
  const existing = await getCall(callSid);
  if (!existing) return false;
  if (existing.whatsapp_sent) return false;

  const meta = parseSummary(existing.summary);
  meta.whatsapp_sent = true;

  const { data, error } = await supabase
    .from('calls')
    .update({ summary: serializeSummary(meta) })
    .eq('sautikit_call_sid', callSid)
    .select('id')
    .maybeSingle();

  throwIfError('markWhatsappSent', error);
  return Boolean(data);
}

/**
 * Persist escalation target on the call summary (no schema migration).
 * @param {{ callSid: string, teammate?: { name?: string, role?: string, phone?: string } | null, reason?: string|null }} opts
 */
async function saveEscalation({ callSid, teammate, reason }) {
  const existing = await getCall(callSid);
  if (!existing) {
    throw new Error(`[db] saveEscalation: no call for ${callSid}`);
  }

  const meta = parseSummary(existing.summary);
  if (teammate && (teammate.name || teammate.role)) {
    meta.escalated_to = {
      name: String(teammate.name || '').trim() || null,
      role: String(teammate.role || '').trim() || null,
      phone: String(teammate.phone || '').trim() || null,
    };
  }
  if (reason != null && String(reason).trim()) {
    meta.escalate_reason = String(reason).trim();
  }

  const { data, error } = await supabase
    .from('calls')
    .update({ summary: serializeSummary(meta) })
    .eq('sautikit_call_sid', callSid)
    .select('*')
    .maybeSingle();

  throwIfError('saveEscalation', error);
  return shapeCall(data);
}

async function markEscalationSent(callSid) {
  const existing = await getCall(callSid);
  if (!existing) return false;
  if (existing.escalation_sent) return false;

  const meta = parseSummary(existing.summary);
  meta.escalation_sent = true;

  const { data, error } = await supabase
    .from('calls')
    .update({ summary: serializeSummary(meta) })
    .eq('sautikit_call_sid', callSid)
    .select('id')
    .maybeSingle();

  throwIfError('markEscalationSent', error);
  return Boolean(data);
}

/**
 * Merge structured Brain summary fields into calls.summary JSON.
 */
async function mergeCallSummaryMeta({ callSid, patch = {} } = {}) {
  if (!callSid || !patch || typeof patch !== 'object') return null;
  const existing = await getCall(callSid);
  if (!existing) return null;
  const meta = parseSummary(existing.summary);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    meta[key] = value;
  }
  const { data, error } = await supabase
    .from('calls')
    .update({ summary: serializeSummary(meta) })
    .eq('sautikit_call_sid', callSid)
    .select('id, summary')
    .maybeSingle();
  throwIfError('mergeCallSummaryMeta', error);
  return data || null;
}

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
 * Mark a call as finished (complete / failed / no_answer) and optionally set duration.
 * Matches on sautikit_call_sid. Idempotent — safe to call from multiple webhooks.
 * Does not reopen a call that is already terminal unless upgrading duration.
 */
async function updateCallStatus({ callSid, status, durationSeconds, force = false }) {
  if (!callSid) {
    throw new Error('[db] updateCallStatus: callSid required');
  }

  const normalized = String(status || '')
    .toLowerCase()
    .replace(/_/g, '-');
  let finalStatus = 'complete';
  if (normalized.includes('fail') || normalized.includes('error')) {
    finalStatus = 'failed';
  } else if (normalized.includes('no-answer') || normalized.includes('noanswer')) {
    finalStatus = 'no_answer';
  } else if (normalized.includes('busy')) {
    finalStatus = 'failed';
  } else if (
    normalized.includes('complete') ||
    normalized.includes('hangup') ||
    normalized === 'ended' ||
    normalized === 'done'
  ) {
    finalStatus = 'complete';
  } else if (status) {
    // Preserve explicit schema values like complete / failed / no_answer / in_progress.
    finalStatus = String(status);
  }

  const existing = await getCall(callSid);
  if (!existing) {
    console.warn(`[db] updateCallStatus: no call row for ${callSid}`);
    return null;
  }

  const terminalStatuses = new Set(['complete', 'completed', 'failed', 'no_answer']);
  const alreadyTerminal = terminalStatuses.has(String(existing.status || '').toLowerCase());
  const patch = {};

  // Prefer explicit failure over a later "complete" from media close.
  if (!alreadyTerminal || force) {
    patch.status = finalStatus;
  } else if (
    String(existing.status).toLowerCase() === 'complete' &&
    (finalStatus === 'failed' || finalStatus === 'no_answer')
  ) {
    patch.status = finalStatus;
  }

  if (durationSeconds != null && Number.isFinite(Number(durationSeconds))) {
    const nextDuration = Math.max(0, Math.round(Number(durationSeconds)));
    if (existing.duration_seconds == null || existing.duration_seconds === 0 || nextDuration > 0) {
      // Always accept a positive duration; fill zeros from later webhooks.
      if (!existing.duration_seconds || nextDuration >= Number(existing.duration_seconds || 0)) {
        patch.duration_seconds = nextDuration;
        // Billable minutes ≈ talk time (0.1 min resolution). Used by one-KES wallet charge.
        patch.ai_processing_minutes = Math.round((nextDuration / 60) * 10) / 10;
      }
    }
  }

  if (Object.keys(patch).length === 0) {
    // Still attempt charge if we already have minutes (idempotent).
    if (WALLET_CHARGING_ENABLED && existing.id && Number(existing.ai_processing_minutes) > 0) {
      await chargeCallToWallet({
        callId: existing.id,
        minutes: Number(existing.ai_processing_minutes),
      }).catch((err) => {
        console.warn('[db] chargeCallToWallet:', err?.message || err);
      });
    }
    return existing;
  }

  const { data, error } = await supabase
    .from('calls')
    .update(patch)
    .eq('sautikit_call_sid', callSid)
    .select('*')
    .maybeSingle();

  throwIfError('updateCallStatus', error);
  const shaped = shapeCall(data);

  if (
    WALLET_CHARGING_ENABLED &&
    shaped?.id &&
    Number(shaped.ai_processing_minutes || patch.ai_processing_minutes || 0) > 0
  ) {
    await chargeCallToWallet({
      callId: shaped.id,
      minutes: Number(shaped.ai_processing_minutes || patch.ai_processing_minutes),
    }).catch((err) => {
      console.warn('[db] chargeCallToWallet:', err?.message || err);
    });
  }

  return shaped;
}

/**
 * Persist AI assist outcome on a call row.
 * Soft-fails when call_resolution.sql has not been applied yet.
 */
async function setCallResolution({
  callSid,
  resolution,
  primaryIntent,
  resolutionNote,
} = {}) {
  if (!callSid) return null;
  const allowed = new Set([
    'resolved',
    'needs_human',
    'abandoned',
    'unresolved',
    'unknown',
  ]);
  const nextResolution = allowed.has(String(resolution || '').toLowerCase())
    ? String(resolution).toLowerCase()
    : 'unknown';
  const patch = {
    resolution: nextResolution,
    primary_intent: primaryIntent
      ? String(primaryIntent).replace(/\s+/g, ' ').trim().slice(0, 80)
      : null,
    resolution_note: resolutionNote
      ? String(resolutionNote).replace(/\s+/g, ' ').trim().slice(0, 240)
      : null,
  };

  const { data, error } = await supabase
    .from('calls')
    .update(patch)
    .eq('sautikit_call_sid', callSid)
    .select('id, resolution, primary_intent, resolution_note')
    .maybeSingle();

  if (error) {
    if (/resolution|primary_intent|column|schema cache/i.test(error.message || '')) {
      console.warn(
        '[db] setCallResolution skipped (apply docs/supabase/call_resolution.sql):',
        error.message
      );
      return null;
    }
    throwIfError('setCallResolution', error);
  }
  return data || null;
}

/**
 * Debit tenant KES wallet for a completed call.
 * Idempotent in Postgres (unique ledger reference = call id).
 */
async function chargeCallToWallet({ callId, minutes, rateKesPerMin } = {}) {
  if (!callId) return null;
  const mins = Number(minutes);
  if (!Number.isFinite(mins) || mins <= 0) return null;

  const rate = Number.isFinite(Number(rateKesPerMin))
    ? Number(rateKesPerMin)
    : WALLET_RATE_KES_PER_MINUTE;

  const { data, error } = await supabase.rpc('charge_call_to_wallet', {
    p_call_id: callId,
    p_minutes: mins,
    p_rate_kes_per_min: rate,
  });

  if (error) {
    // Pre-migration: SQL not applied yet — do not fail the call path.
    if (/function|does not exist|schema cache/i.test(error.message || '')) {
      console.warn('[db] charge_call_to_wallet missing — apply docs/supabase/one_wallet_billing.sql');
      return null;
    }
    throwIfError('chargeCallToWallet', error);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.charged) {
    console.log(
      `[db] wallet charge call=${callId} amount_kes=${row.amount_kes} balance=${row.wallet_balance_kes}`
    );
  }

  // Automatic live low/empty prepaid alerts (idempotent). Never blocks the call path.
  try {
    const { data: callRow, error: callErr } = await supabase
      .from('calls')
      .select('tenant_id')
      .eq('id', callId)
      .maybeSingle();
    if (!callErr && callRow?.tenant_id) {
      const { maybeNotifyWalletBalanceAlerts } = require('./notifications/walletAlerts');
      const alerted = await maybeNotifyWalletBalanceAlerts(supabase, {
        tenantId: callRow.tenant_id,
      });
      for (const a of alerted?.alerts || []) {
        if (a.channel) {
          console.log(
            `[db] wallet ${a.kind} alert via ${a.channel}` +
              (a.to ? ` → ${a.to}` : '') +
              ` tenant=${callRow.tenant_id}`
          );
        } else {
          console.warn(
            `[db] wallet ${a.kind} alert skipped (${a.reason || 'no_channel'}) tenant=${callRow.tenant_id}`
          );
        }
      }
    }
  } catch (err) {
    console.warn('[db] wallet balance alert:', err?.message || err);
  }

  return row || null;
}

async function attachRecording({
  callSid,
  recordingUrl,
  recordingSid,
  sourceUrl,
  authHeader,
}) {
  const existing = await getCall(callSid);
  if (!existing) {
    throw new Error(`[db] attachRecording: no call for ${callSid}`);
  }

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

  const meta = parseSummary(existing.summary);
  if (recordingSid) meta.recording_sid = recordingSid;
  if (recordingPath) meta.recording_path = recordingPath;

  const { data, error } = await supabase
    .from('calls')
    .update({
      recording_url: finalUrl,
      status: 'complete',
      summary: serializeSummary(meta),
    })
    .eq('sautikit_call_sid', callSid)
    .select('*')
    .maybeSingle();

  throwIfError('attachRecording', error);
  return shapeCall(data);
}

async function getTenantById(tenantId) {
  if (!tenantId) return null;
  let { data, error } = await supabase
    .from('tenants')
    .select(
      'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, notify_channels, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, product_catalog, social_handles, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, tts_lexicon, soniox_voice_id, soniox_voice_label, vertical, handoff_mode, business_locations, business_policies, is_active'
    )
    .eq('id', tenantId)
    .maybeSingle();

  if (error && /notify_channels/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, product_catalog, social_handles, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, tts_lexicon, soniox_voice_id, soniox_voice_label, vertical, handoff_mode, business_locations, business_policies, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }

  if (error && /soniox_voice_id|soniox_voice_label/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, product_catalog, social_handles, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, tts_lexicon, vertical, handoff_mode, business_locations, business_policies, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }

  // Older DBs may lack newer KA columns — peel them off gradually.
  if (error && /product_catalog|social_handles/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, tts_lexicon, vertical, handoff_mode, business_locations, business_policies, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (
    error &&
    /vertical|handoff_mode|business_locations|business_policies/i.test(error.message)
  ) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, tts_lexicon, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /tts_lexicon/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, daily_bulletin, agent_tools, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /agent_tools/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, alert_email, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, daily_bulletin, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /alert_email/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, daily_bulletin, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /daily_bulletin/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, services_catalog, faqs, team_directory, unknown_answer_fallback, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /services_catalog/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, services_offered, faqs, team_directory, unknown_answer_fallback, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /faqs|team_directory|services_offered|unknown_answer_fallback/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, agent_name, agent_tone, business_hours, hours_schedule, after_hours_mode, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /after_hours_mode/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, agent_name, agent_tone, business_hours, hours_schedule, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }
  if (error && /hours_schedule|agent_name|agent_tone|business_hours|column/i.test(error.message)) {
    ({ data, error } = await supabase
      .from('tenants')
      .select(
        'id, business_name, sautikit_virtual_number, llm_system_prompt, whatsapp_notification_number, is_active'
      )
      .eq('id', tenantId)
      .maybeSingle());
  }

  throwIfError('getTenantById', error);
  return data || null;
}

/**
 * Resolve tenant profile for a live call (by callSid → tenant_id, else DID / fallback).
 */
async function getTenantProfile({ callSid, toNumber, tenantId } = {}) {
  let resolvedId = tenantId || DEFAULT_TENANT_ID || null;

  if (!resolvedId && callSid) {
    const call = await getCall(callSid);
    if (call?.tenant_id) resolvedId = call.tenant_id;
  }

  if (!resolvedId) {
    resolvedId = await resolveTenantId({ toNumber, tenantId });
  }

  const row = await getTenantById(resolvedId);
  if (!row) {
    return {
      id: resolvedId,
      businessName: process.env.BUSINESS_NAME || 'the business',
      agentName: process.env.AGENT_NAME || 'Receptionist',
      llmSystemPrompt: null,
      knowledge: process.env.BUSINESS_KNOWLEDGE || null,
      hoursSchedule: null,
      businessHours: null,
      agentTone: null,
      afterHoursMode: 'serve',
      servicesCatalog: [],
      productCatalog: [],
      socialHandles: {},
      servicesOffered: null,
      faqs: [],
      teamDirectory: [],
      unknownAnswerFallback: null,
      dailyBulletin: [],
      alertEmail: null,
      notifyChannels: { sms: true, whatsapp: true, email: true },
      agentTools: { escalate: true, end_call: true },
      ttsLexicon: [],
      sonioxVoiceId: null,
      sonioxVoiceLabel: null,
      vertical: 'general',
      handoffMode: 'callback',
      businessLocations: [],
      businessPolicies: {},
    };
  }

  const { parseAgentTools } = require('./conversation/agentTools');
  const { parseLexiconOverrides } = require('./speech/pronunciationLexicon');
  const { parseVertical } = require('./conversation/vertical');
  const { parseHandoffMode } = require('./conversation/handoffMode');
  const { parseNotifyChannels } = require('./notifications/notifyChannels');
  const afterHoursMode =
    String(row.after_hours_mode || 'serve').trim().toLowerCase() === 'message'
      ? 'message'
      : 'serve';

  return {
    id: row.id,
    businessName: row.business_name,
    agentName: row.agent_name || 'Receptionist',
    agentTone: row.agent_tone || null,
    llmSystemPrompt: row.llm_system_prompt || null,
    knowledge: process.env.BUSINESS_KNOWLEDGE || null,
    whatsappNumber: row.whatsapp_notification_number || null,
    alertEmail: row.alert_email || null,
    notifyChannels: parseNotifyChannels(row.notify_channels),
    did: row.sautikit_virtual_number || null,
    hoursSchedule: row.hours_schedule || null,
    businessHours: row.business_hours || null,
    afterHoursMode,
    servicesCatalog: row.services_catalog || [],
    productCatalog: row.product_catalog || [],
    socialHandles: row.social_handles || {},
    servicesOffered: row.services_offered || null,
    faqs: row.faqs || [],
    teamDirectory: row.team_directory || [],
    unknownAnswerFallback: row.unknown_answer_fallback || null,
    dailyBulletin: row.daily_bulletin || [],
    agentTools: parseAgentTools(row.agent_tools),
    ttsLexicon: parseLexiconOverrides(row.tts_lexicon),
    sonioxVoiceId: row.soniox_voice_id || null,
    sonioxVoiceLabel: row.soniox_voice_label || null,
    vertical: parseVertical(row.vertical),
    handoffMode: parseHandoffMode(row.handoff_mode),
    businessLocations: row.business_locations || [],
    businessPolicies: row.business_policies || {},
  };
}

/**
 * Upsert a contact by tenant + phone (when phone present).
 * Falls back to insert-only when phone is missing.
 */
async function upsertContact({
  tenantId,
  phone,
  name,
  lastReason,
  notes,
  metadata,
} = {}) {
  if (!tenantId) return null;
  const phoneNorm = String(phone || '').trim() || null;
  const nameNorm = String(name || '').trim() || null;
  const reasonNorm = String(lastReason || '').trim() || null;
  const notesNorm = String(notes || '').trim() || null;
  const now = new Date().toISOString();

  if (phoneNorm) {
    const { data: existing, error: findErr } = await supabase
      .from('contacts')
      .select('id, name, notes, last_reason, metadata')
      .eq('tenant_id', tenantId)
      .eq('phone', phoneNorm)
      .maybeSingle();
    if (findErr && /contacts|relation/i.test(findErr.message)) {
      console.warn('[db] upsertContact skipped (apply contacts_and_requests.sql):', findErr.message);
      return null;
    }
    throwIfError('upsertContact(find)', findErr);

    if (existing?.id) {
      const patch = {
        updated_at: now,
        name: nameNorm || existing.name || null,
        last_reason: reasonNorm || existing.last_reason || null,
        notes: notesNorm || existing.notes || null,
        metadata: {
          ...(existing.metadata && typeof existing.metadata === 'object'
            ? existing.metadata
            : {}),
          ...(metadata && typeof metadata === 'object' ? metadata : {}),
        },
      };
      const { data, error } = await supabase
        .from('contacts')
        .update(patch)
        .eq('id', existing.id)
        .select('*')
        .maybeSingle();
      throwIfError('upsertContact(update)', error);
      return data || null;
    }
  }

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      tenant_id: tenantId,
      phone: phoneNorm,
      name: nameNorm,
      last_reason: reasonNorm,
      notes: notesNorm,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
      updated_at: now,
    })
    .select('*')
    .maybeSingle();

  if (error && /contacts|relation/i.test(error.message)) {
    console.warn('[db] upsertContact skipped (apply contacts_and_requests.sql):', error.message);
    return null;
  }
  throwIfError('upsertContact(insert)', error);
  return data || null;
}

const REQUEST_TYPES = new Set(['hold', 'enquiry', 'order', 'callback', 'other']);

/**
 * Create a service request (hold / enquiry / order) for retail completion.
 * Also upserts contact and mirrors a short note into call summary when callSid given.
 */
async function createServiceRequest({
  callSid,
  tenantId,
  type,
  name,
  phone,
  item,
  quantity,
  whenText,
  notes,
} = {}) {
  let resolvedTenantId = tenantId || null;
  let callRow = null;
  if (callSid) {
    callRow = await getCall(callSid);
    if (callRow?.tenant_id) resolvedTenantId = callRow.tenant_id;
  }
  if (!resolvedTenantId) return null;

  const requestType = REQUEST_TYPES.has(String(type || '').trim().toLowerCase())
    ? String(type).trim().toLowerCase()
    : 'enquiry';
  const callerName = String(name || callRow?.name || '').trim() || null;
  const callerPhone =
    String(phone || callRow?.from_number || '').trim() || null;
  const itemText = String(item || '').trim() || null;
  const qtyText = String(quantity || '').trim() || null;
  const when = String(whenText || '').trim() || null;
  const noteText = String(notes || '').trim() || null;

  const contact = await upsertContact({
    tenantId: resolvedTenantId,
    phone: callerPhone,
    name: callerName,
    lastReason:
      [requestType, itemText, when].filter(Boolean).join(' — ') || noteText,
  });

  const { data, error } = await supabase
    .from('service_requests')
    .insert({
      tenant_id: resolvedTenantId,
      contact_id: contact?.id || null,
      call_id: callRow?.id || null,
      request_type: requestType,
      status: 'open',
      item: itemText,
      quantity: qtyText,
      when_text: when,
      notes: noteText,
      caller_name: callerName,
      caller_phone: callerPhone,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .maybeSingle();

  if (error && /service_requests|relation/i.test(error.message)) {
    console.warn(
      '[db] createServiceRequest skipped (apply contacts_and_requests.sql):',
      error.message
    );
    return null;
  }
  throwIfError('createServiceRequest', error);

  if (callSid && data) {
    const existing = await getCall(callSid);
    if (existing) {
      const meta = parseSummary(existing.summary);
      meta.service_request_id = data.id;
      meta.service_request_type = requestType;
      if (itemText) meta.service_request_item = itemText;
      const reasonBits = [
        requestType,
        itemText,
        qtyText ? `qty ${qtyText}` : null,
        when,
      ].filter(Boolean);
      if (!meta.reason && reasonBits.length) {
        meta.reason = reasonBits.join(' — ');
      }
      if (callerName) meta.name = callerName;
      await supabase
        .from('calls')
        .update({ summary: serializeSummary(meta) })
        .eq('sautikit_call_sid', callSid);
    }
  }

  return data || null;
}

/**
 * Update an existing service request (e.g. refine hold when_text on the same call).
 */
async function updateServiceRequest({
  id,
  type,
  name,
  phone,
  item,
  quantity,
  whenText,
  notes,
} = {}) {
  if (!id) return null;
  const patch = {
    updated_at: new Date().toISOString(),
  };
  if (type != null) {
    const requestType = REQUEST_TYPES.has(String(type || '').trim().toLowerCase())
      ? String(type).trim().toLowerCase()
      : null;
    if (requestType) patch.request_type = requestType;
  }
  if (name != null) patch.caller_name = String(name || '').trim() || null;
  if (phone != null) patch.caller_phone = String(phone || '').trim() || null;
  if (item != null) patch.item = String(item || '').trim() || null;
  if (quantity != null) patch.quantity = String(quantity || '').trim() || null;
  if (whenText != null) patch.when_text = String(whenText || '').trim() || null;
  if (notes != null) patch.notes = String(notes || '').trim() || null;

  const { data, error } = await supabase
    .from('service_requests')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error && /service_requests|relation/i.test(error.message)) {
    console.warn(
      '[db] updateServiceRequest skipped (apply contacts_and_requests.sql):',
      error.message
    );
    return null;
  }
  throwIfError('updateServiceRequest', error);
  return data || null;
}

module.exports = {
  upsertCall,
  saveCallerInfo,
  saveEscalation,
  appendTranscript,
  attachRecording,
  updateCallStatus,
  setCallResolution,
  chargeCallToWallet,
  uploadRecordingBuffer,
  getCall,
  getTenantById,
  getTenantProfile,
  listActiveTenantDids,
  markWhatsappSent,
  markEscalationSent,
  upsertContact,
  createServiceRequest,
  updateServiceRequest,
  mergeCallSummaryMeta,
  RECORDINGS_BUCKET,
  shapeCall,
};
