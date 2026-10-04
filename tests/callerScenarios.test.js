const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBrainState,
  observeCallerTurn,
  formatBrainStateForPrompt,
  setNextBestAction,
} = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const {
  extractName,
  extractConversationEntities,
  looksLikeCompliment,
} = require('../src/conversation/entityExtraction');
const { missingGoalSlots } = require('../src/conversation/goalModel');
const { fileNameAskLine } = require('../src/conversation/turnPolicy');
const {
  openLineHoldDecision,
  shouldPublishOpenFileSentence,
} = require('../src/conversation/openLineSpeech');
const { ensureRequiredEscalate } = require('../src/conversation/requiredEscalate');
const { executeBrainTools } = require('../src/conversation/toolExecution');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');
const { fileReadLine } = require('../src/conversation/fileRead');
const {
  applyMessageOnlyCapabilities,
} = require('../src/conversation/messageOnly');
const { formatPlaybookForPrompt } = require('../src/conversation/playbooks');

const CALL_NOW = new Date('2026-10-04T16:58:00+03:00');

const alvinCard = {
  name: 'Alvin',
  fileOwnerName: 'Alvin',
  sharedLine: false,
  greetByName: true,
  alternateNames: ['Brian'],
  nextAppointment: 'carpet, Thursday 10 AM',
  openVisits: ['carpet, Thursday 10 AM'],
  recentBookings: ['couch cleaning, 3 March'],
};

function profileFor(mode, vertical = 'home_services') {
  return {
    vertical,
    afterHoursMode: mode,
    callerMemory: {
      ...alvinCard,
      alternateNames: [...alvinCard.alternateNames],
      openVisits: [...alvinCard.openVisits],
      recentBookings: [...alvinCard.recentBookings],
    },
    servicesCatalog: [{ name: 'Carpet cleaning' }],
  };
}

function turn(state, text, profile) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile,
    now: CALL_NOW,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

function askedFile(profile) {
  return turn(createBrainState(profile), 'Hello', profile);
}

const serveCaps = {
  createAppointment: true,
  saveCallerInfo: true,
  createServiceRequest: true,
  updateAppointment: true,
  escalate: true,
};

async function runTools(toolBody, { held = 'Alvin', confirmed = true, capabilities = serveCaps, handlers = {} } = {}) {
  const saved = [];
  const execution = await executeBrainTools({
    parsed: parseGeminiResponse(toolBody),
    capabilities,
    hoursSchedule: defaultHoursSchedule(),
    now: CALL_NOW,
    nameConfirmed: confirmed,
    heldCallerName: held,
    handlers: {
      createAppointment: async (appointment) => {
        saved.push(appointment);
        return {
          id: 'appt_scenario',
          status: 'requested',
          service_name: appointment.serviceName,
          when_text: appointment.whenText,
          caller_name: appointment.name,
          address_landmark: appointment.landmark,
        };
      },
      createServiceRequest: async (request) => {
        saved.push(request);
        return { id: 'req_scenario', request_type: request.type, status: 'open' };
      },
      updateAppointment: async (update) => {
        saved.push(update);
        return { id: 'appt_scenario', status: update.status || 'updated' };
      },
      ...handlers,
    },
  });
  return { execution, saved };
}

describe('full assistant caller scenarios', () => {
  let profile;
  beforeEach(() => {
    profile = profileFor('serve');
  });

  it('yes binds Alvin only', () => {
    const seeded = createBrainState(profile);
    const early = turn(seeded, 'Yes', profile);
    assert.equal(early.caller.name, null);
    assert.equal(early.caller.nameConfirmed, false);

    const asked = turn(seeded, 'Hello', profile);
    assert.equal(asked.caller.fileNameAsked, 'Alvin');
    const bound = turn(asked, 'Yes', profile);
    assert.equal(bound.caller.name, 'Alvin');
    assert.equal(bound.caller.nameConfirmed, true);
    assert.equal(bound.entities.name.source, 'caller_file');
    assert.notEqual(bound.caller.name, 'Brian');
  });

  it('this is Alvin speaking locks Alvin', () => {
    const said = turn(askedFile(profile), 'This is Alvin speaking.', profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.notEqual(said.caller.name, 'Alvin speaking');
    assert.equal(said.caller.nameConfirmed, true);
    assert.equal(extractName('This is Alvin speaking.'), 'Alvin');
  });

  it('uh, Alvin locks Alvin', () => {
    const said = turn(askedFile(profile), 'Uh, Alvin.', profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.notEqual(said.caller.name, 'Uh Alvin');
    assert.equal(said.caller.nameConfirmed, true);
    assert.equal(said.entities.name.source, 'caller_file');
  });

  it("yes, you're speaking with Alvin locks Alvin", () => {
    const said = turn(askedFile(profile), "Yes, you're speaking with Alvin.", profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.equal(said.caller.nameConfirmed, true);
    assert.equal(said.entities.name.source, 'caller_file');
  });

  it('no, this is Jane does not keep Alvin', () => {
    const said = turn(askedFile(profile), 'No, this is Jane.', profile);
    assert.notEqual(said.caller.name, 'Alvin');
    assert.equal(said.caller.name, 'Jane');
    assert.notEqual(said.caller.nameConfirmed && said.caller.name, 'Alvin');
  });

  it('a compliment is not a name', () => {
    const impressed = "Actually, I'm impressed by your work";
    assert.equal(looksLikeCompliment(impressed), true);
    assert.equal(extractName(impressed), null);
    const fromIm = turn(createBrainState(profile), impressed, profile);
    assert.equal(fromIm.caller.name, null);
    assert.equal(fromIm.caller.nameConfirmed, false);

    const praise = "You're really good at this.";
    assert.equal(extractName(praise), null);
    const fromPraise = turn(askedFile(profile), praise, profile);
    assert.notEqual(fromPraise.caller.name, 'Really');
    assert.equal(fromPraise.caller.name, null);
    assert.equal(fromPraise.caller.nameConfirmed, false);
  });

  it('at around 9 is not the name Ataround', () => {
    const asked = askedFile(profile);
    asked.caller.fileNameAskSpoken = true;
    const said = turn(asked, 'At around 9', profile);
    assert.notEqual(said.caller.name, 'Ataround');
    assert.notEqual(said.entities?.name?.value, 'Ataround');
    assert.equal(extractName('At around 9'), null);
    assert.equal(said.caller.nameConfirmed, false);
  });

  it('after the file-name ask, booking carpet cleaning does not ask the name again and saves caller Alvin', async () => {
    const asked = askedFile(profile);
    assert.equal(fileNameAskLine(asked), 'Am I speaking with Alvin?');
    asked.caller.fileNameAskSpoken = true;
    const booking = turn(asked, 'Ok book carpet cleaning for me', profile);
    assert.equal(booking.caller.fileNameAsked, 'Alvin');
    assert.equal(missingGoalSlots(booking, profile).includes('name'), false);
    const decision = determineNextBestAction({ state: booking, capabilities: serveCaps });
    assert.notEqual(decision.slot, 'name');
    const prompt = formatBrainStateForPrompt(booking);
    assert.match(prompt, /Use Alvin/);
    assert.match(prompt, /Do not ask for a name/);
    assert.doesNotMatch(prompt, /Ask once: Am I speaking with Alvin/);
    assert.equal(fileNameAskLine(booking), '');

    const { execution, saved } = await runTools(
      '###TOOL###{"create_appointment":{"service_name":"carpet cleaning","name":"Ataround","when_text":"tomorrow at 9 AM","location":"Westlands ABC"}}###ENDTOOL###',
      { held: 'Alvin', confirmed: booking.caller.nameConfirmed === true }
    );
    assert.equal(execution.results.find((row) => row.action === 'create_appointment').status, 'succeeded');
    assert.equal(saved[0].name, 'Alvin');
    assert.equal(saved[0].serviceName.toLowerCase(), 'carpet cleaning');
  });

  it('tomorrow morning saves exactly Monday 5 October 2026, morning with empty window_start and window_end', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Ataround","when_text":"tomorrow morning","location":"Westlands ABC","window_start":"2026-10-05T07:00:00.000Z","window_end":"2026-10-05T07:00:00.000Z"}}###ENDTOOL###'
    );
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved[0].whenText, 'Monday 5 October 2026, morning');
    assert.equal(saved[0].windowStart, '');
    assert.equal(saved[0].windowEnd, '');
    assert.equal(/10:00|10 AM/.test(saved[0].whenText), false);
  });

  it('tomorrow at 9 AM saves exactly Monday 5 October 2026, 9 AM', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Alvin","when_text":"tomorrow at 9 AM","location":"Westlands ABC"}}###ENDTOOL###'
    );
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved[0].whenText, 'Monday 5 October 2026, 9 AM');
  });

  it('tomorrow at exactly 9:00 AM at Westlands ABC saves Monday 5 October 2026, 9 AM, carpet cleaning, Westlands ABC, Alvin', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_appointment":{"service_name":"carpet cleaning","name":"Ataround","when_text":"tomorrow at exactly 9:00 AM","location":"Westlands ABC"}}###ENDTOOL###'
    );
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved[0].whenText, 'Monday 5 October 2026, 9 AM');
    assert.equal(saved[0].serviceName.toLowerCase(), 'carpet cleaning');
    assert.equal(saved[0].landmark, 'Westlands ABC');
    assert.equal(saved[0].name, 'Alvin');
  });

  it('a later note does not ask the name again and uses Alvin', async () => {
    const locked = turn(askedFile(profile), 'Yes', profile);
    assert.equal(locked.caller.name, 'Alvin');
    const note = 'Make a note for the team to contact me urgently about the window cleaning';
    const notedTurn = turn(locked, note, profile);
    assert.equal(notedTurn.intent, 'human');
    const state = setNextBestAction(
      notedTurn,
      determineNextBestAction({ state: notedTurn, capabilities: serveCaps })
    );
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(fileNameAskLine(state), '');
    assert.doesNotMatch(
      formatBrainStateForPrompt(state),
      /May I have your name|Tell me your name|Ask once for their name|Ask once: Am I speaking/i
    );
    const injected = ensureRequiredEscalate({}, state, serveCaps);
    assert.equal(injected.escalate.name, 'Alvin');

    let noted = null;
    const execution = await executeBrainTools({
      parsed: { escalate: { teammate: 'owner', name: 'Jane', reason: note } },
      capabilities: serveCaps,
      nameConfirmed: true,
      heldCallerName: state.caller.name,
      handlers: {
        escalate: async (info) => {
          noted = info;
          return { ok: true, channel: 'whatsapp' };
        },
      },
    });
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(noted.name, 'Alvin');
  });

  it('name turn does not speak open visits', () => {
    const asked = askedFile(profile);
    const ask = fileNameAskLine(asked);
    assert.equal(ask, 'Am I speaking with Alvin?');
    assert.doesNotMatch(ask, /carpet|Thursday|visit|callback/i);
    const prompt = formatBrainStateForPrompt(asked);
    assert.match(prompt, /Do not talk about visits yet/);
    assert.match(prompt, /Do not say nothing is open/);

    const locked = turn(asked, 'Yes', profile);
    const hold = openLineHoldDecision({
      nameConfirmed: true,
      nameJustConfirmed: true,
      callerText: 'Yes',
    });
    assert.equal(hold.holdNameConfirm, true);
    assert.equal(shouldPublishOpenFileSentence(hold, false), false);
    assert.equal(locked.returning.openVisits[0], 'carpet, Thursday 10 AM');
  });
});

describe('message only caller scenarios', () => {
  let profile;
  beforeEach(() => {
    profile = profileFor('message');
  });
  const caps = applyMessageOnlyCapabilities(
    {
      createServiceRequest: true,
      createAppointment: true,
      updateAppointment: true,
      saveCallerInfo: true,
    },
    'message'
  );

  it('yes still locks Alvin', () => {
    const asked = createBrainState(profile);
    asked.caller.fileNameAskSpoken = true;
    const bound = turn(asked, 'Yes', profile);
    assert.equal(bound.caller.name, 'Alvin');
    assert.equal(bound.caller.nameConfirmed, true);
    assert.equal(bound.entities.name.source, 'caller_file');
    assert.doesNotMatch(formatBrainStateForPrompt(bound), /Thursday 10 AM/);
  });

  it('a booking is refused', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Alvin","when_text":"tomorrow at 9 AM","location":"Westlands ABC"}}###ENDTOOL###',
      { capabilities: caps }
    );
    assert.equal(saved.length, 0);
    assert.equal(execution.results[0].action, 'create_appointment');
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('a cancel is refused', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"update_appointment":{"status":"cancelled"}}###ENDTOOL###',
      { capabilities: caps }
    );
    assert.equal(saved.length, 0);
    assert.equal(execution.results[0].action, 'update_appointment');
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('a reschedule is refused', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"update_appointment":{"when_text":"Tuesday at 11 AM","status":"rescheduled"}}###ENDTOOL###',
      { capabilities: caps }
    );
    assert.equal(saved.length, 0);
    assert.equal(execution.results[0].action, 'update_appointment');
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('a hold is refused', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_service_request":{"type":"hold","name":"Alvin","item":"HP printer","when_text":"5 PM"}}###ENDTOOL###',
      { capabilities: caps }
    );
    assert.equal(saved.length, 0);
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('an order is refused', async () => {
    const { execution, saved } = await runTools(
      '###TOOL###{"create_service_request":{"type":"order","name":"Alvin","item":"HP printer"}}###ENDTOOL###',
      { capabilities: caps }
    );
    assert.equal(saved.length, 0);
    assert.equal(execution.results[0].code, 'message_only');
  });

  it('a visit read is refused', () => {
    const state = turn(createBrainState(profile), 'What are my visits?', profile);
    const line = fileReadLine({
      text: 'What are my visits?',
      state,
      language: 'en',
    });
    assert.match(line, /take a message/i);
    assert.doesNotMatch(line, /Thursday|carpet/i);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /Thursday 10 AM/);
  });

  it('a callback can be taken', async () => {
    const asked = createBrainState(profile);
    asked.caller.fileNameAskSpoken = true;
    const locked = turn(asked, 'Yes', profile);
    assert.equal(locked.caller.name, 'Alvin');
    const { execution, saved } = await runTools(
      '###TOOL###{"create_service_request":{"type":"callback","name":"Jane","item":"Please call about the sofa","when_text":"tomorrow at 9 AM"}}###ENDTOOL###',
      { capabilities: caps, held: locked.caller.name, confirmed: true }
    );
    assert.equal(execution.results[0].status, 'succeeded');
    assert.equal(saved[0].type, 'callback');
    assert.equal(saved[0].name, 'Alvin');
    assert.equal(saved[0].whenText, '');
  });
});

describe('playbook caller scenarios', () => {
  // Two real packs: home_services and retail. Hospitality and general have none.
  const verticals = ['home_services', 'retail'];

  for (const vertical of verticals) {
    it(`${vertical} playbook locks yes to Alvin`, () => {
      const block = formatPlaybookForPrompt({ vertical });
      assert.match(block, /PLAYBOOK/);
      const profile = profileFor('serve', vertical);
      const bound = turn(askedFile(profile), 'Yes', profile);
      assert.equal(bound.caller.name, 'Alvin');
      assert.equal(bound.caller.nameConfirmed, true);
      assert.equal(bound.entities.name.source, 'caller_file');
    });

    it(`${vertical} playbook message-only refuses a booking`, async () => {
      const block = formatPlaybookForPrompt({ vertical });
      assert.match(block, /PLAYBOOK/);
      const profile = profileFor('message', vertical);
      const state = createBrainState(profile);
      assert.equal(state.messageOnly, true);
      const caps = applyMessageOnlyCapabilities(
        { createAppointment: true, createServiceRequest: true, updateAppointment: true },
        profile.afterHoursMode
      );
      const { execution, saved } = await runTools(
        '###TOOL###{"create_appointment":{"service_name":"Carpet cleaning","name":"Alvin","when_text":"tomorrow at 9 AM","location":"Westlands ABC"}}###ENDTOOL###',
        { capabilities: caps, held: 'Alvin' }
      );
      assert.equal(saved.length, 0);
      assert.equal(execution.results[0].code, 'message_only');
      assert.equal(execution.results[0].action, 'create_appointment');
    });
  }
});
