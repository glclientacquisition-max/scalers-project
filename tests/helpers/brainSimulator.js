// Offline caller simulator. Runs the same turn contract as server.js
// (docs/agents/BRAIN_TURN_CONTRACT.md) with an adversarial Gemini stub and
// fake tool handlers, then checks the universal invariants after every turn.
// No network. Used by tests/brainSimulation.test.js and by playbook authors.

const {
  createBrainState,
  inferIntent,
  observeCallerTurn,
  setNextBestAction,
  recordActionResults,
} = require('../../src/conversation/brainState');
const { extractConversationEntities } = require('../../src/conversation/entityExtraction');
const { buildBrainCapabilities } = require('../../src/conversation/brainPolicy');
const { determineNextBestAction } = require('../../src/conversation/nextBestAction');
const {
  analyzeCallerLanguage,
  createLanguageState,
  resolveLanguageState,
} = require('../../src/conversation/language');
const { resolveLocalReply, classifyCallerTurn } = require('../../src/conversation/turnPolicy');
const { parseGeminiResponse } = require('../../src/conversation/toolMarkers');
const { ensureRequiredEscalate } = require('../../src/conversation/requiredEscalate');
const {
  ensureRequiredCreateRequest,
  guardToolPlan,
} = require('../../src/conversation/requiredCreateRequest');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../../src/conversation/toolExecution');
const { spokenTextForToolTurn } = require('../../src/conversation/geminiVoice');
const { pickSpeechGuaranteeLine, polishSpokenReply } = require('../../src/conversation/dynamicSpeech');
const {
  SAVED_CLAIM,
  TRANSFER_CLAIM,
  knownNumbers,
  numbersIn,
  toolSucceededThisTurn,
} = require('../../src/conversation/speechGuard');
const { collectKnownCallerNames } = require('../../src/conversation/callerNameMatch');
const { defaultHoursSchedule } = require('../../src/conversation/businessHours');

const GLUED_WORDS = /\b(?:I|We|They)(?:can|am|have|will)\b|\b(?:How|What|When|Where)(?:can|do|is|are)[a-z]+\b/;
const MAX_LOCAL_WORDS = 25;

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function catalogNames(profile) {
  const names = [];
  for (const list of [profile.productCatalog, profile.servicesCatalog]) {
    for (const item of Array.isArray(list) ? list : []) {
      const name = String(item?.name || '').trim();
      if (name) names.push(name.toLowerCase());
    }
  }
  return names;
}

function fingerprintQuestion(line) {
  return String(line || '')
    .toLowerCase()
    .replace(/[^a-z0-9? ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Adversarial Gemini stub. Answers like a helpful but leaky model: it asks for
 * the slot the state wants, then adds one leak the guards must strip. When the
 * state says CREATE_REQUEST it emits the tool marker and a premature claim.
 */
function adversarialGemini({ state, decision, text, leak = 'rotate', turnIndex = 0 }) {
  const action = String(decision?.action || '');
  const slot = String(decision?.slot || '');
  const leaks = [
    'It costs 500 shillings.',
    "Stay on the line, I'm transferring you now.",
    'We can definitely come to Runda.',
    "I've booked that for you.",
    'We have 7 slots left tomorrow.',
  ];
  const chosen =
    leak === 'none'
      ? ''
      : leak === 'rotate'
        ? leaks[turnIndex % leaks.length]
        : String(leak || '');

  if (action === 'CREATE_REQUEST') {
    // Premature success claim without a marker: the required-tool injector must
    // add the tool and the speech guard must drop the claim.
    return `${chosen} Done, that is all booked.`.trim();
  }
  if (action === 'ASK_CLARIFICATION') {
    const asks = {
      name: 'May I have your name?',
      reason: 'What do you need help with?',
      when: 'What day and time would you prefer?',
      time: 'What day and time would you prefer?',
      location: 'Where should we come?',
      landmark: 'Where should we come?',
      area: 'Which area is that in?',
      quantity: 'How many would you like?',
      service: 'What do you need done?',
      confirm: 'Shall I go ahead?',
    };
    return `${chosen} ${asks[slot] || 'How can I help?'}`.trim();
  }
  if (action === 'ESCALATE') {
    return `${chosen} I will pass this to the team.`.trim();
  }
  if (/\?\s*$/.test(String(text || ''))) {
    return `${chosen} Yes, we can help with that.`.trim();
  }
  return `${chosen} Okay.`.trim();
}

/**
 * @param {object} opts
 * @param {object} opts.profile  tenant profile (vertical, catalogs, policies)
 * @param {object} [opts.capabilities]
 * @param {(ctx: object) => string} [opts.gemini]  returns raw model text
 * @param {object} [opts.handlers]  overrides for fake tool handlers
 * @param {Date} [opts.now]
 */
function createSimulator({
  profile = {},
  capabilities,
  gemini = adversarialGemini,
  handlers = {},
  now = new Date(Date.UTC(2026, 7, 18, 8, 0, 0)),
  agentName = 'Amani',
  businessName = 'Test Business',
  leak = 'rotate',
} = {}) {
  const caps =
    capabilities ||
    buildBrainCapabilities(profile, {
      createServiceRequest: true,
      createAppointment: true,
      updateAppointment: true,
      liveTransfer: false,
    });
  const saved = { serviceRequests: [], appointments: [], appointmentUpdates: [], escalations: [], callerInfo: [] };
  let counter = 0;
  const fakeHandlers = {
    createServiceRequest: async (request) => {
      counter += 1;
      const row = { id: `sr_${counter}`, request_type: request.type, ...request };
      saved.serviceRequests.push(row);
      return row;
    },
    updateServiceRequest: async (request) => {
      const row = { id: request.id || `sr_${counter}`, ...request };
      return row;
    },
    createAppointment: async (appointment) => {
      counter += 1;
      const row = { id: `apt_${counter}`, status: 'requested', ...appointment };
      saved.appointments.push(row);
      return row;
    },
    updateAppointment: async (update) => {
      const row = { id: update.id || `apt_${counter}`, status: update.status || 'requested', ...update };
      saved.appointmentUpdates.push(row);
      return row;
    },
    saveCallerInfo: async (info) => {
      saved.callerInfo.push(info);
      return { ok: true, ...info };
    },
    escalate: async (payload) => {
      counter += 1;
      saved.escalations.push(payload);
      return { ok: true, channel: 'whatsapp', id: `esc_${counter}` };
    },
    ...handlers,
  };

  let state = createBrainState(profile);
  let languageState = createLanguageState();
  let lastAgentText = '';
  const turns = [];
  const violations = [];
  const callerTurns = [];
  const recentQuestions = [];
  const names = catalogNames(profile);

  function check(turn) {
    const line = turn.agentLine;
    const where = `turn ${turns.length} caller="${turn.callerText}" agent="${line}"`;
    const flag = (rule) => violations.push(`${rule}: ${where}`);

    if (!line && turn.decision?.action !== 'END') flag('dead_air');
    if (turn.outcome !== 'gemini' && words(line).length > MAX_LOCAL_WORDS) flag('local_line_too_long');
    if (GLUED_WORDS.test(line)) flag('glued_words');
    if (SAVED_CLAIM.test(line) && !toolSucceededThisTurn(turn.toolResults)) flag('saved_claim_without_tool');
    if (TRANSFER_CLAIM.test(line) && !caps.liveTransfer) flag('transfer_claim');
    const known = knownNumbers({
      callerTurns,
      profile,
      toolResults: turn.toolResults,
      extra: JSON.stringify(turn.state.entities || {}),
    });
    for (const n of numbersIn(line)) {
      if (!known.has(n)) flag(`invented_number_${n}`);
    }
    if (String(profile.vertical || '').toLowerCase() === 'home_services' && /\blandmark\b/i.test(line)) {
      flag('said_landmark');
    }
    const lower = line.toLowerCase();
    const dump = names.filter((n) => lower.includes(n)).length;
    const askedForList = /\b(what|which) (?:services|products|do you (?:do|sell|offer))\b/i.test(turn.callerText);
    if (dump >= 3 && !askedForList) flag('catalogue_dump');
    if (turn.state.conversation?.nonConsentAck && toolSucceededThisTurn(turn.toolResults)) {
      flag('tool_on_ack');
    }
    if (/\?\s*$/.test(line)) {
      recentQuestions.push(fingerprintQuestion(line));
      const last3 = recentQuestions.slice(-3);
      if (last3.length === 3 && new Set(last3).size === 1) flag('same_question_three_times');
    } else {
      recentQuestions.length = 0;
    }
  }

  async function turn(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    const evidence = analyzeCallerLanguage(clean);
    languageState = resolveLanguageState(languageState, evidence);
    const callLanguage = languageState.current || 'en';
    const provisionalIntent = inferIntent(clean, { vertical: profile.vertical });
    const entityIntent =
      provisionalIntent === 'general_enquiry' && state.goal.status === 'active'
        ? state.intent
        : provisionalIntent;
    const entities = extractConversationEntities(clean, {
      profile,
      intent: entityIntent,
      state,
    });
    state = observeCallerTurn(state, {
      text: clean,
      languageState,
      entities,
      profile,
      lastAgentText,
    });
    const decision = determineNextBestAction({ state, capabilities: caps });
    state = setNextBestAction(state, decision);
    callerTurns.push(clean);

    let agentLine = '';
    let outcome = 'gemini';
    let toolResults = [];
    let rawModel = '';
    const local = resolveLocalReply({
      text: clean,
      state,
      profile,
      language: callLanguage,
      agentName,
      businessName,
      nextBestAction: decision,
    });
    if (local) {
      agentLine = local.line;
      outcome = local.outcome;
    } else {
      rawModel = gemini({ state, decision, text: clean, profile, language: callLanguage, leak, turnIndex: turns.length });
      const parsed = parseGeminiResponse(rawModel);
      const enforced = guardToolPlan(
        ensureRequiredEscalate(ensureRequiredCreateRequest(parsed, state, caps), state, caps),
        state,
        caps
      );
      const execution = await executeBrainTools({
        parsed: enforced,
        capabilities: caps,
        completedFingerprints: state.actions.completedFingerprints,
        priorHolds: state.actions.openHolds || [],
        productCatalog: profile.productCatalog || null,
        agentName,
        businessName,
        hoursSchedule: profile.hoursSchedule || defaultHoursSchedule(),
        now,
        nameConfirmed: state.caller?.nameConfirmed === true,
        openAppointments: profile.openAppointments || [],
        callerPhone: state.caller?.phone || '',
        knownNames: collectKnownCallerNames({ profile, state }),
        businessPolicies: profile.businessPolicies || null,
        businessLocations: profile.businessLocations || null,
        handlers: fakeHandlers,
      });
      if (enforced.needsVisitTime) {
        execution.results.push({
          action: 'create_appointment',
          status: 'invalid',
          code: 'unparsed_when',
          reason: 'Visit has a day but no time.',
          missingSlots: ['when_text'],
          hours: { whenText: String(enforced.needsVisitTime) },
        });
      }
      toolResults = execution.results;
      state = recordActionResults(state, toolResults);
      const actionConfirmation = formatToolConfirmation(toolResults, callLanguage);
      const spoken = polishSpokenReply(
        spokenTextForToolTurn({ spoken: parsed.spokenText, toolResults }),
        {
          language: callLanguage,
          state,
          profile,
          capabilities: caps,
          callerTurns: state.conversation?.answersReceived || [],
          toolResults,
        }
      );
      agentLine = [spoken, actionConfirmation].filter(Boolean).join(' ').trim();
      if (!agentLine) {
        // server.js turn speech guarantee: never leave the caller in silence.
        agentLine = pickSpeechGuaranteeLine({
          nextBestAction: decision,
          brainState: state,
          language: callLanguage,
          userText: clean,
        });
        outcome = 'guarantee';
      }
    }

    lastAgentText = agentLine;
    const record = {
      callerText: clean,
      kind: classifyCallerTurn(clean),
      decision,
      outcome,
      rawModel,
      agentLine,
      toolResults,
      state,
      language: callLanguage,
    };
    turns.push(record);
    check(record);
    return record;
  }

  async function run(script) {
    const out = [];
    for (const text of script) out.push(await turn(text));
    return out;
  }

  return {
    turn,
    run,
    get state() {
      return state;
    },
    turns,
    violations,
    saved,
    capabilities: caps,
    transcript: () =>
      turns.map((t) => `caller: ${t.callerText}\nagent [${t.outcome}]: ${t.agentLine}`).join('\n'),
  };
}

module.exports = { adversarialGemini, createSimulator };
