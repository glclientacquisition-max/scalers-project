'use strict';
// In-process Brain driver for the BA v2 Phase 0 harness.
// Mirrors tests/helpers/brainSimulator.js (the server.js turn contract) but:
//  - loads Brain modules from any build root (main, curated staging, live staging),
//  - writes into a fake tenant DB seeded from the scenario fixture,
//  - applies the BRAIN_TRUST_P1 server.js hooks when the build has them and the flag is on,
//  - times Brain-only work per turn (model time excluded).
const path = require('path');

function loadBrain(root) {
  const r = (p) => require(path.join(root, 'src/conversation', p));
  const opt = (p) => { try { return r(p); } catch { return null; } };
  return {
    brainState: r('brainState'),
    entityExtraction: r('entityExtraction'),
    brainPolicy: r('brainPolicy'),
    nextBestAction: r('nextBestAction'),
    language: r('language'),
    turnPolicy: r('turnPolicy'),
    toolMarkers: r('toolMarkers'),
    requiredEscalate: r('requiredEscalate'),
    requiredCreateRequest: r('requiredCreateRequest'),
    toolExecution: r('toolExecution'),
    geminiVoice: r('geminiVoice'),
    dynamicSpeech: r('dynamicSpeech'),
    callerNameMatch: r('callerNameMatch'),
    businessHours: r('businessHours'),
    callResolution: r('callResolution'),
    callSummary: r('callSummary'),
    trustP1: opt('trustP1'),
    events: require(path.join(root, 'src/notifications/events')),
  };
}

function createFakeDb(seed = {}, callerPhone) {
  const db = {
    service_requests: (seed.service_requests || []).map((r) => ({ ...r, _seed: true })),
    appointments: (seed.appointments || []).map((r) => ({ ...r, _seed: true })),
    handoffs: [],
    complaints: [],
    contacts: { name: seed.contactName || null, names: seed.contactName ? [seed.contactName] : [] },
    foreignTouches: [],
    writes: [],
  };
  let n = 0;
  const id = (p) => `${p}_${++n}`;
  const handlers = {
    createServiceRequest: async (req) => {
      const row = { id: id('sr'), request_type: req.type, status: 'open', item: req.item, quantity: req.quantity, when_text: req.whenText, caller_name: req.name, caller_phone: callerPhone, notes: req.notes };
      db.service_requests.push(row);
      if (/complain/i.test(String(req.type))) db.complaints.push(row);
      if (/callback|handoff/i.test(String(req.type))) db.handoffs.push({ via: 'service_request', ...row });
      db.writes.push(['create_service_request', row.id, req.type]);
      return row;
    },
    updateServiceRequest: async (req) => {
      const row = db.service_requests.find((r) => r.id === req.id);
      if (row) Object.assign(row, { when_text: req.whenText || row.when_text, item: req.item || row.item });
      db.writes.push(['update_service_request', req.id]);
      return row || { id: req.id };
    },
    createAppointment: async (a) => {
      const row = { id: id('apt'), status: 'requested', service_name: a.serviceName, when_text: a.whenText, window_start: a.windowStart || null, address_landmark: a.landmark, notes: a.notes || null, caller_name: a.name, caller_phone: callerPhone };
      db.appointments.push(row);
      db.writes.push(['create_appointment', row.id]);
      // Platform contract (#680): supersedes[] closes this call's open callback rows in the same write.
      for (const sid of a.supersedes || []) { const h = db.handoffs.find((x) => x.id === sid); if (h) h.status = 'superseded'; }
      return row;
    },
    updateAppointment: async (u) => {
      // Same targeting as src/db.js today: explicit id (tenant filter only) else latest open by phone.
      const wanted = u.appointmentId || u.id || '';
      let row = wanted ? db.appointments.find((r) => r.id === wanted) : null;
      if (!row) {
        const mine = db.appointments.filter((r) => r.caller_phone === callerPhone && !/cancel|done/.test(r.status));
        row = mine[mine.length - 1] || null;
      }
      if (!row) return null;
      if (row.caller_phone !== callerPhone) db.foreignTouches.push(row.id);
      if (u.status) row.status = u.status;
      if (u.whenText) row.when_text = u.whenText;
      if (u.windowStart) row.window_start = u.windowStart;
      if (u.landmark) row.address_landmark = u.landmark;
      row._touched = true;
      db.writes.push(['update_appointment', row.id]);
      return { ...row };
    },
    saveCallerInfo: async (info) => {
      // `replace` mirrors v2 save_caller_name: replaces the primary name on a confirmed correction.
      if (info?.name) { db.contacts.name = info.replace ? info.name : (db.contacts.name || info.name); if (!db.contacts.names.includes(info.name)) db.contacts.names.push(info.name); }
      return { ok: true, ...info };
    },
    escalate: async (p) => {
      const row = { id: id('esc'), ...p };
      db.handoffs.push({ via: 'escalate', ...row });
      if (/complain|malalamiko|sijaridhika/i.test(String(p.reason || ''))) db.complaints.push(row);
      db.writes.push(['escalate', row.id]);
      return { ok: true, channel: 'whatsapp', id: row.id, notify: 'queued' };
    },
  };
  return { db, handlers };
}

function withEnv(flags, fn) {
  const keys = Object.keys(flags || {});
  const prev = {};
  for (const k of keys) { prev[k] = process.env[k]; if (flags[k] == null) delete process.env[k]; else process.env[k] = flags[k]; }
  return Promise.resolve().then(fn).finally(() => { for (const k of keys) { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; } });
}

/**
 * Run one call. `model(ctx)` returns raw model text (stand-in or replayed).
 * `caller(ctx)` returns the next caller line or null to hang up.
 */
const V2_ON = () => /^(1|true|on|yes)$/i.test(String(process.env.BRAIN_V2 || ''));
async function runCall(opts) {
  if (V2_ON() && require('fs').existsSync(path.join(opts.root, 'src/conversation/v2/index.js'))) return require('./driverV2').runCallV2(opts, createFakeDb);
  return runCallV1(opts);
}
async function runCallV1({ root, profile, seed, callerPhone = '+254700000001', model, caller, maxTurns = 14, now, agentName = 'Shy', businessName }) {
  const B = loadBrain(root);
  const { db, handlers } = createFakeDb(seed, callerPhone);
  const prof = { ...profile, openAppointments: (seed?.appointments || []).filter((a) => a.caller_phone === callerPhone) };
  const caps = B.brainPolicy.buildBrainCapabilities(prof, { createServiceRequest: true, createAppointment: true, updateAppointment: true, liveTransfer: false });
  let state = B.brainState.createBrainState(prof);
  state.caller = { ...(state.caller || {}), phone: callerPhone };
  let languageState = B.language.createLanguageState();
  let lastAgentText = '';
  const turns = [];
  const allResults = [];
  const callerTurns = [];
  const trust = B.trustP1 && typeof B.trustP1.trustP1Enabled === 'function' && B.trustP1.trustP1Enabled() ? B.trustP1 : null;
  const exec = (parsed) => B.toolExecution.executeBrainTools({
    parsed, capabilities: caps, completedFingerprints: state.actions.completedFingerprints, priorHolds: state.actions.openHolds || [],
    productCatalog: prof.productCatalog || null, agentName, businessName, hoursSchedule: prof.hoursSchedule || B.businessHours.defaultHoursSchedule(),
    now, nameConfirmed: state.caller?.nameConfirmed === true, heldCallerName: String(state.caller?.name || '').trim(),
    openAppointments: prof.openAppointments || [], callerPhone, knownNames: B.callerNameMatch.collectKnownCallerNames({ profile: prof, state }),
    businessPolicies: prof.businessPolicies || null, businessLocations: prof.businessLocations || null, handlers,
  });

  for (let i = 0; i < maxTurns; i++) {
    const text = caller({ i, lastAgentText, turns, state });
    if (text == null) break;
    const clean = String(text).replace(/\s+/g, ' ').trim();
    const t0 = process.hrtime.bigint();
    let modelNs = 0n;
    let agentLine = '';
    let outcome = 'model';
    let toolResults = [];
    let rawModel = '';
    let decision = null;
    let error = null;
    let callLanguage = 'en';
    try {
      languageState = B.language.resolveLanguageState(languageState, B.language.analyzeCallerLanguage(clean));
      callLanguage = languageState.current || 'en';
      const provisional = B.brainState.inferIntent(clean, { vertical: prof.vertical });
      const entityIntent = provisional === 'general_enquiry' && state.goal.status === 'active' ? state.intent : provisional;
      const entities = B.entityExtraction.extractConversationEntities(clean, { profile: prof, intent: entityIntent, state });
      state = B.brainState.observeCallerTurn(state, { text: clean, languageState, entities, profile: prof, lastAgentText, now });
      decision = B.nextBestAction.determineNextBestAction({ state, capabilities: caps });
      state = B.brainState.setNextBestAction(state, decision);
      callerTurns.push(clean);

      let handled = false;
      if (trust && typeof trust.planTrustTurn === 'function') {
        const plan = trust.planTrustTurn({ text: clean, state, card: null, tasks: [], lastAgentText, language: callLanguage, now: now.getTime() });
        if (plan && (plan.line || plan.parsed)) {
          let line = plan.line || '';
          if (plan.parsed && (plan.kind === 'apply' || plan.kind === 'callback')) {
            const ex = await exec(plan.parsed);
            toolResults = ex.results;
            state = B.brainState.recordActionResults(state, toolResults);
            const ok = trust.receiptsOf(toolResults).length > 0;
            if (plan.kind === 'apply') line = plan.parsed.trustComplaint ? (ok ? plan.line : plan.failLine) : (B.toolExecution.formatToolConfirmation(toolResults, callLanguage) || line);
            if (plan.parsed.trustComplaint && ok) db.complaints.push({ via: 'trust_complaint' });
          }
          agentLine = line; outcome = `trust_${plan.kind}`; handled = Boolean(line);
        }
      }
      if (!handled) {
        const local = B.turnPolicy.resolveLocalReply({ text: clean, state, profile: prof, language: callLanguage, agentName, businessName, nextBestAction: decision });
        if (local) { agentLine = local.line; outcome = local.outcome; }
        else {
          const m0 = process.hrtime.bigint();
          rawModel = model({ i, state, decision, text: clean, profile: prof, language: callLanguage, callerTurns });
          modelNs = process.hrtime.bigint() - m0;
          const parsed = B.toolMarkers.parseGeminiResponse(rawModel);
          const RC = B.requiredCreateRequest;
          let enforced = RC.guardToolPlan(B.requiredEscalate.ensureRequiredEscalate(RC.ensureRequiredCreateRequest(parsed, state, caps), state, caps), state, caps);
          if (trust) {
            const routed = trust.routeVisitRequest?.(enforced, state, caps);
            if (routed) { Object.keys(enforced).forEach((k) => delete enforced[k]); Object.assign(enforced, routed); }
            if (enforced?.appointment && !String(enforced.appointment.whenText || '').trim()) { const held = trust.heldWhen?.(state); if (held) enforced.appointment = { ...enforced.appointment, whenText: held }; }
            if (enforced?.serviceRequest) { const miss = trust.saveMissingSlot?.(enforced.serviceRequest, state); if (miss) enforced.serviceRequest = { ...enforced.serviceRequest, __trustMissingSlot: miss }; }
          }
          const ex = await exec(enforced);
          if (enforced.needsVisitTime) ex.results.push({ action: 'create_appointment', status: 'invalid', code: 'unparsed_when', missingSlots: ['when_text'], hours: { whenText: String(enforced.needsVisitTime) } });
          toolResults = ex.results;
          state = B.brainState.recordActionResults(state, toolResults);
          const confirmation = B.toolExecution.formatToolConfirmation(toolResults, callLanguage);
          let spoken = B.dynamicSpeech.polishSpokenReply(B.geminiVoice.spokenTextForToolTurn({ spoken: parsed.spokenText, toolResults }), {
            language: callLanguage, state, profile: prof, capabilities: caps, callerTurns: state.conversation?.answersReceived || [], toolResults,
          });
          if (trust?.shapeSpeech) spoken = trust.shapeSpeech(spoken, { state, language: callLanguage, toolResults, receiptLine: confirmation }).text;
          agentLine = [spoken, confirmation].filter(Boolean).join(' ').trim();
          if (!agentLine) { agentLine = B.dynamicSpeech.pickSpeechGuaranteeLine({ nextBestAction: decision, brainState: state, language: callLanguage, userText: clean }); outcome = 'guarantee'; }
        }
      }
    } catch (e) { error = String(e && e.stack || e).split('\n').slice(0, 3).join(' | '); }
    const brainMs = Number(process.hrtime.bigint() - t0 - modelNs) / 1e6;
    allResults.push(...toolResults);
    lastAgentText = agentLine;
    turns.push({ i, callerText: clean, agentLine, outcome, decision: decision && { action: decision.action, slot: decision.slot }, rawModel, toolResults: toolResults.map((r) => ({ action: r.action, status: r.status, code: r.code })), language: callLanguage, brainMs, toolTurn: toolResults.length > 0, error });
    if (error) break;
  }
  // Owner email as today's pipeline renders it.
  let ownerText = '';
  try {
    const res = B.callResolution.deriveCallResolution({ brainState: state, toolResults: allResults, turnCount: turns.length });
    const summary = B.callSummary.deriveCallSummary({ brainState: state });
    const ev = B.events.ownerLeadEvent({ name: state.caller?.name, caller_number: callerPhone, resolution_note: res.resolutionNote, summary_meta: { reason: summary.reason }, reason: summary.reason, primary_intent: summary.primaryIntent || res.primaryIntent }, businessName);
    ownerText = B.events.renderEventText ? B.events.renderEventText(ev) : JSON.stringify(ev.fields);
  } catch (e) { ownerText = `__owner_render_error ${e.message}`; }
  db.contacts.finalStateName = state.caller?.nameConfirmed ? state.caller.name : null;
  return { turns, db, state, ownerText, results: allResults };
}

module.exports = { runCall, withEnv, loadBrain };
