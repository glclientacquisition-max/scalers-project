#!/usr/bin/env node
// Score one stored call.
//
// Traces (staging): voice_turn_traces rows for the call. Prod Voice runs with
// traces off (VOICE_TRACE auto is off on a "prod" Railway environment) and the
// prod database has no voice_turn_traces table, so prod calls are scored from
// the stored transcript instead:
//
//   node scripts/score-voice-call.js CALL_ID                     # traces (Supabase env)
//   node scripts/score-voice-call.js CALL_ID --file trace.jsonl  # traces (JSONL sink)
//   node scripts/score-voice-call.js CALL_ID --transcripts       # calls + transcripts + appointments (Supabase env)
//   node scripts/score-voice-call.js CALL_ID --rows call.json    # same, from an exported JSON file
//
// CALL_ID is calls.id (uuid) or the SautiKit sid (HD_...). --rows takes
// { call: { id, created_at, tenant_id, ... }, transcripts: [{ speaker, text_content, created_at }],
//   openVisits: [{ service_name, when_text, window_start, status }], agentName, businessName,
//   callerFile: { name, openVisits, openRequests } }.
//   --ctx facts.json adds the same call facts to a trace run (traces carry no caller file).
// Transcript scoring has no latency, language tags, or model output, so slow,
// language and deleted-answer checks are weaker there; visit read, Nairobi date
// and name lock work on the spoken text.

const fs = require('fs');
const { readStoredTurns } = require('../src/speech/voiceTrace');
const { scoreTurns, diagnoseCall, formatSummary } = require('../src/speech/voiceScore');
const { turnsFromTranscriptRows } = require('../src/speech/callChecks');

const OPEN_VISIT_STATUS = ['requested', 'confirmed', 'open', 'pending', 'scheduled'];

function arg(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

function flag(name) {
  return process.argv.includes(name);
}

async function loadTranscriptCall(callId) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or pass --rows file.json');
  }
  const { supabase } = require('../src/lib/supabaseClient');
  const column = /^HD_/i.test(callId) ? 'sautikit_call_sid' : 'id';
  const { data: call, error } = await supabase
    .from('calls')
    .select('id, created_at, tenant_id, caller_number, sautikit_call_sid')
    .eq(column, callId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!call) throw new Error(`No call ${callId}`);
  const { data: transcripts, error: tErr } = await supabase
    .from('transcripts')
    .select('speaker, text_content, created_at')
    .eq('call_id', call.id)
    // Prod writes all rows of a call with one created_at and there is no
    // sequence column; ties come back in insert order (not guaranteed).
    .order('created_at', { ascending: true });
  if (tErr) throw new Error(tErr.message);
  let openVisits = null;
  if (call.caller_number) {
    // Visits on file for this caller when the call started.
    const { data: visits, error: vErr } = await supabase
      .from('appointments')
      .select('service_name, when_text, window_start, status, created_at')
      .eq('tenant_id', call.tenant_id)
      .eq('caller_phone', call.caller_number)
      .lt('created_at', call.created_at)
      .in('status', OPEN_VISIT_STATUS);
    if (!vErr) openVisits = visits || [];
  }
  // The caller file as it stood when the call started: contact name and
  // open holds. Read-only. Used by the ignored-caller-file check.
  let callerFile = null;
  if (call.caller_number) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('name')
      .eq('tenant_id', call.tenant_id)
      .eq('phone', call.caller_number)
      .maybeSingle();
    const { data: requests, error: rErr } = await supabase
      .from('service_requests')
      .select('request_type, item, notes, status, created_at')
      .eq('tenant_id', call.tenant_id)
      .eq('caller_phone', call.caller_number)
      .eq('status', 'open')
      .lt('created_at', call.created_at);
    callerFile = {
      name: contact?.name || null,
      openVisits: openVisits || [],
      openRequests: rErr ? [] : requests || [],
    };
  }
  return { call, transcripts: transcripts || [], openVisits, callerFile };
}

async function main() {
  const callId = process.argv.slice(2).find((item, i, all) => item && !item.startsWith('--') && !['--file', '--rows', '--ctx'].includes(all[i - 1]));
  if (!callId) {
    console.error('Usage: node scripts/score-voice-call.js CALL_ID [--file trace.jsonl | --transcripts | --rows call.json]');
    process.exit(1);
  }
  let turns;
  let ctx = {};
  const rowsFile = arg('--rows');
  if (rowsFile || flag('--transcripts')) {
    const bundle = rowsFile ? JSON.parse(fs.readFileSync(rowsFile, 'utf8')) : await loadTranscriptCall(callId);
    const call = bundle.call || {};
    turns = turnsFromTranscriptRows(bundle.transcripts || [], { callId: call.id || callId, callAt: call.created_at });
    ctx = {
      callAt: call.created_at || null,
      openVisits: Array.isArray(bundle.openVisits) ? bundle.openVisits : null,
      agentName: bundle.agentName || null,
      businessName: bundle.businessName || null,
      callerFile: bundle.callerFile || null,
    };
  } else {
    const file = arg('--file');
    turns = await readStoredTurns(callId, file ? { file } : {});
    // Traces carry no caller file: --ctx facts.json passes { callAt, callerFile, ... }.
    const ctxFile = arg('--ctx');
    if (ctxFile) ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
  }
  if (!turns.length) {
    console.error(`No turns for ${callId}`);
    process.exit(1);
  }
  const body = scoreTurns(turns, ctx);
  const scorecard = {
    calls: [
      {
        callId,
        score: body.score,
        checks: body.checks,
        nameAsks: body.nameAsks,
        turns: body.turns,
        historical: [],
      },
    ],
  };
  console.log(formatSummary(scorecard));
  const diagnosis = diagnoseCall(body);
  console.log(diagnosis);
  console.log(
    JSON.stringify(
      { callId, score: body.score, checks: body.checks, diagnosis, nameAsks: body.nameAsks, callFindings: body.callFindings },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});
