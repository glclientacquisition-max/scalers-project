const { describe, it } = require('node:test');
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
  isPlausibleCallerName,
  looksLikeCompliment,
} = require('../src/conversation/entityExtraction');
const { missingGoalSlots } = require('../src/conversation/goalModel');
const { resolveLocalReply, fileNameAskLine, planCallerModelTurn } = require('../src/conversation/turnPolicy');
const { openLineHoldDecision, shouldPublishOpenFileSentence, formatNameConfirmSpeech } = require('../src/conversation/openLineSpeech');
const fs = require('fs');
const path = require('path');
const { ensureRequiredEscalate } = require('../src/conversation/requiredEscalate');
const { executeBrainTools, formatToolConfirmation } = require('../src/conversation/toolExecution');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const { buildSttContext, isSttContextEnabled } = require('../src/speech/sttContext');

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

function turn(state, text, profile) {
  return observeCallerTurn(state, {
    text,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
    profile,
    entities: extractConversationEntities(text, { profile, state }),
  });
}

describe('caller name stays the file name', () => {
  it('does not treat a compliment as a name or an empty file', () => {
    const text = "Actually, I'm impressed by your work";
    assert.equal(looksLikeCompliment(text), true);
    assert.equal(extractName(text), null);
    assert.equal(isPlausibleCallerName('impressed by your'), false);
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const state = turn(createBrainState(profile), text, profile);
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    assert.notEqual(state.returning?.fileRole, 'other');
    assert.deepEqual(profile.callerMemory.openVisits, ['carpet, Thursday 10 AM']);
    assert.equal(
      resolveLocalReply({
        text,
        state,
        profile,
        language: 'en',
      }),
      null
    );
    const prompt = formatBrainStateForPrompt(state);
    assert.match(prompt, /Am I speaking with Alvin/);
    assert.match(prompt, /Do not say nothing is open/);
    assert.doesNotMatch(prompt, /FILE: nothing is saved|I don't have a booking|Nothing is still open/i);
    assert.equal(state.caller.fileNameAsked, 'Alvin');
  });

  it('binds yes only to the file name the code just asked', () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const seeded = createBrainState(profile);
    const earlyYes = turn(seeded, 'Yes', profile);
    assert.equal(earlyYes.caller.name, null);
    assert.equal(earlyYes.caller.nameConfirmed, false);

    const asked = turn(seeded, 'Hello', profile);
    assert.equal(asked.caller.fileNameAsked, 'Alvin');
    assert.match(formatBrainStateForPrompt(asked), /Am I speaking with Alvin/);

    const bound = turn(asked, 'Yes', profile);
    assert.equal(bound.caller.name, 'Alvin');
    assert.equal(bound.caller.nameConfirmed, true);
    assert.equal(bound.entities.name.source, 'caller_file');
    assert.equal(bound.returning.fileRole, 'primary');
    assert.equal(bound.returning.nextVisit, 'carpet, Thursday 10 AM');
    assert.equal(bound.caller.fileNameAsked, null);
  });

  it('does not keep an I\'m span that is not the file name', () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const state = turn(createBrainState(profile), "I'm Brian", profile);
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    assert.deepEqual(profile.callerMemory.openVisits, ['carpet, Thursday 10 AM']);
  });

  it('asks once when no name is on file and does not auto-confirm I\'m', () => {
    const profile = { vertical: 'home_services' };
    const said = turn(createBrainState(profile), "I'm Alvin", profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.equal(said.caller.nameConfirmed, false);
    assert.equal(said.entities.name.source, 'caller_im');
    assert.match(formatBrainStateForPrompt(said), /Do not ask for the name again/);

    const continued = turn(said, 'I need carpet cleaning tomorrow', profile);
    assert.equal(continued.caller.name, 'Alvin');
    assert.equal(continued.caller.nameConfirmed, true);
    assert.equal(missingGoalSlots(continued, profile).includes('name'), false);
    assert.match(formatBrainStateForPrompt(continued), /Do not ask for the name again/);

    const junk = turn(createBrainState(profile), "Actually, I'm impressed by your work", profile);
    assert.equal(junk.caller.name, null);
  });

  it('uses the locked name for a later visit, booking, cancel, and escalate without asking again', async () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const asked = turn(createBrainState(profile), 'Hello', profile);
    const locked = turn(asked, 'Yes', profile);
    assert.equal(locked.caller.name, 'Alvin');

    const visit = turn(locked, 'What are my bookings?', profile);
    const visitPrompt = formatBrainStateForPrompt(visit);
    assert.match(visitPrompt, /Do not re-ask the name/);
    assert.match(visitPrompt, /carpet, Thursday 10 AM/);
    assert.doesNotMatch(visitPrompt, /Ask once for their name|Am I speaking with/i);
    assert.equal(visit.caller.name, 'Alvin');

    const booking = turn(locked, 'Book carpet cleaning tomorrow morning in Rongai', profile);
    assert.equal(booking.caller.name, 'Alvin');
    assert.equal(missingGoalSlots(booking, profile).includes('name'), false);
    assert.match(formatBrainStateForPrompt(booking), /Do not ask for the name again|Do not re-ask the name/);

    const cancel = turn(locked, 'Please cancel the visit', profile);
    assert.equal(cancel.caller.name, 'Alvin');
    assert.equal(cancel.caller.nameConfirmed, true);
    assert.equal(missingGoalSlots(cancel, profile).includes('name'), false);
    assert.doesNotMatch(formatBrainStateForPrompt(cancel), /Ask once for their name|what's your name/i);

    const escalateState = {
      ...locked,
      intent: 'human',
      handoff: { requested: true, reason: 'Caller requested the owner' },
      resolution: { nextBestAction: 'ESCALATE', reason: 'human' },
      goal: { ...(locked.goal || {}), missingSlots: [], description: 'speak to the owner' },
    };
    const injected = ensureRequiredEscalate({ escalate: null }, escalateState, { escalate: true });
    assert.equal(injected.escalate.name, 'Alvin');

    const parsed = parseGeminiResponse(
      '###TOOL###{"save_caller_info":{"name":"impressed by your","reason":"owner"},"escalate":{"teammate":"owner","name":"impressed by your","reason":"Caller requested the owner"},"create_appointment":{"service_name":"carpet cleaning","name":"impressed by your","when_text":"tomorrow 10 AM","location":"Rongai"}}###ENDTOOL###'
    );
    let savedName = null;
    let escalatedName = null;
    let bookedName = null;
    const execution = await executeBrainTools({
      parsed,
      capabilities: {
        saveCallerInfo: true,
        escalate: true,
        createAppointment: true,
        createServiceRequest: true,
        updateAppointment: true,
      },
      nameConfirmed: true,
      heldCallerName: 'Alvin',
      handlers: {
        saveCallerInfo: async (info) => {
          savedName = info.name;
          return info;
        },
        escalate: async (info) => {
          escalatedName = info.name;
          return { ok: true, channel: 'whatsapp' };
        },
        createAppointment: async (info) => {
          bookedName = info.name;
          return { id: 'appt-1', status: 'scheduled' };
        },
      },
    });
    assert.equal(savedName, 'Alvin');
    assert.equal(escalatedName, 'Alvin');
    assert.equal(bookedName, 'Alvin');
    assert.ok(execution.results.some((row) => row.action === 'save_caller_info' && row.status === 'succeeded'));
  });

  it('asks only the file name and does not publish the open file until a booking ask', () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const asked = turn(createBrainState(profile), 'Hello', profile);
    const ask = fileNameAskLine(asked);
    assert.equal(ask, 'Am I speaking with Alvin?');
    assert.doesNotMatch(ask, /carpet|visit|callback|What would you like to do|Nothing is still open/i);
    assert.equal(
      resolveLocalReply({ text: 'Hello', state: asked, profile, language: 'en' }),
      null
    );

    const locked = turn(asked, 'Uh, my name is Alvin', profile);
    assert.equal(locked.caller.name, 'Alvin');
    assert.equal(locked.caller.nameConfirmed, true);
    assert.equal(fileNameAskLine(locked), '');
    const nameLockHold = openLineHoldDecision({
      nameConfirmed: true,
      nameJustConfirmed: true,
      callerText: 'Uh, my name is Alvin',
    });
    assert.equal(nameLockHold.holdNameConfirm, true);
    assert.equal(shouldPublishOpenFileSentence(nameLockHold, false), false);
    const openFile = formatNameConfirmSpeech({
      language: 'en',
      openVisits: locked.returning.openVisits,
      openRequests: locked.returning.openRequests,
    });
    assert.match(openFile, /carpet/i);
    assert.notEqual(ask, openFile);

    const bookings = turn(locked, 'What are my bookings?', profile);
    assert.equal(bookings.caller.name, 'Alvin');
    const bookingHold = openLineHoldDecision({
      nameConfirmed: true,
      nameJustConfirmed: false,
      callerText: 'What are my bookings?',
    });
    assert.equal(shouldPublishOpenFileSentence(bookingHold, false), true);

    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const start = server.indexOf('async function runCallerTurn');
    const end = server.indexOf('function flushUtterance', start);
    const turnSource = server.slice(start, end);
    assert.match(turnSource, /planCallerModelTurn\(brainState/);
    assert.match(turnSource, /const fileNameAsk = nameGate\.line/);
    assert.match(turnSource, /speakText\(fileNameAsk,/);
    const gateAt = turnSource.indexOf('planCallerModelTurn');
    const modelAt = turnSource.indexOf('runGeminiTurn');
    assert.ok(gateAt >= 0 && modelAt > gateAt);
    const promptStart = server.indexOf("if (data.type === 'prompt')");
    const promptEnd = server.indexOf("ws.on('error'", promptStart);
    const promptSource = server.slice(promptStart, promptEnd);
    const promptGate = promptSource.indexOf('planCallerModelTurn');
    const promptModel = promptSource.indexOf('runGeminiTurn');
    assert.ok(promptGate >= 0 && promptModel > promptGate);
    assert.match(turnSource, /shouldPublishOpenFileSentence\(speechHold, fileReadAsk\)/);
    assert.doesNotMatch(turnSource, /speechHold\.holdSpeech \|\| fileReadAsk/);
    assert.doesNotMatch(turnSource, /speakText\(localReply\.line\)/);
  });


  it('after the file-name ask was spoken and unanswered, a booking turn keeps the file name and does not ask again', () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const asked = turn(createBrainState(profile), 'Hello', profile);
    assert.equal(asked.caller.fileNameAsked, 'Alvin');
    assert.equal(fileNameAskLine(asked), 'Am I speaking with Alvin?');
    asked.caller.fileNameAskSpoken = true;
    assert.equal(fileNameAskLine(asked), '');

    const booking = turn(asked, 'Ok book carpet cleaning for me', profile);
    // structuredClone keeps fileNameAskSpoken from the prior state
    assert.equal(booking.caller.fileNameAskSpoken, true);
    assert.equal(booking.caller.fileNameAsked, 'Alvin');
    assert.equal(booking.caller.nameConfirmed, false);
    assert.equal(booking.intent, 'booking');
    assert.equal(missingGoalSlots(booking, profile).includes('name'), false);

    const decision = determineNextBestAction({
      state: booking,
      capabilities: { createAppointment: true, createServiceRequest: true },
    });
    assert.notEqual(decision.slot, 'name');
    assert.doesNotMatch(
      String(decision.reason || ''),
      /Ask once: Am I speaking|May I have your name|No name is on file/i
    );

    const prompt = formatBrainStateForPrompt(booking);
    assert.match(prompt, /File name already asked: Alvin/);
    assert.match(prompt, /Use Alvin/);
    assert.match(prompt, /Do not ask for a name/);
    assert.match(prompt, /Do not say May I have your name/);
    assert.doesNotMatch(prompt, /Ask once: Am I speaking with Alvin/);
    assert.doesNotMatch(prompt, /Caller name: not on file/);
    assert.doesNotMatch(prompt, /ask only for name/i);

    // Name-only ask still stands before spoken; compliment guard still holds
    const junk = turn(asked, "Actually, I'm impressed by your work", profile);
    assert.equal(junk.caller.name, null);
    assert.equal(junk.caller.nameConfirmed, false);
    assert.equal(junk.caller.fileNameAskSpoken, true);
    assert.equal(fileNameAskLine(junk), '');
  });

  it('puts the file name in Soniox terms without letting the term list decide the name', () => {
    const ctx = buildSttContext({
      businessName: 'Done and Dusted',
      agentName: 'Shy',
      callerMemory: { name: 'Alvin', fileOwnerName: 'Alvin', alternateNames: ['Brian'] },
    });
    assert.ok(ctx.terms.includes('Alvin'));
    assert.ok(ctx.terms.includes('Brian'));
    assert.ok(ctx.general.some((row) => row.key === 'participant' && /Alvin/.test(row.value) && /Brian/.test(row.value)));
    assert.equal(extractName('hello there'), null);
    const prev = process.env.SONIOX_STT_CONTEXT;
    process.env.SONIOX_STT_CONTEXT = 'off';
    assert.equal(isSttContextEnabled(), false);
    if (prev == null) delete process.env.SONIOX_STT_CONTEXT;
    else process.env.SONIOX_STT_CONTEXT = prev;
  });

  it('a barged booking turn asks only the file name and does not run the model', () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'serve', callerMemory: { ...alvinCard } };
    const barge = turn(createBrainState(profile), 'Uh, I want to, like, um, book.', profile);
    assert.equal(barge.caller.nameConfirmed, false);
    assert.equal(barge.caller.fileNameAsked, 'Alvin');
    const gate = planCallerModelTurn(barge, { greetingBarged: true, fileNameAskCommitted: false });
    assert.equal(gate.runModel, false);
    assert.equal(gate.line, 'Am I speaking with Alvin?');
    assert.doesNotMatch(gate.line, /May I have your name|name, please|carpet|visit/i);

    // A greeting that was cancelled must not count as the ask already spoken.
    const preset = turn(createBrainState(profile), 'Uh, I want to, like, um, book.', profile);
    preset.caller.fileNameAskSpoken = true;
    const cleared = planCallerModelTurn(preset, { greetingBarged: true, fileNameAskCommitted: false });
    assert.equal(cleared.runModel, false);
    assert.equal(cleared.line, 'Am I speaking with Alvin?');

    preset.caller.fileNameAskSpoken = true;
    const heard = planCallerModelTurn(preset, { greetingBarged: true, fileNameAskCommitted: true });
    assert.equal(heard.runModel, true);
    assert.equal(heard.line, '');
  });

  it('locks the file name when the caller says this is Alvin speaking', () => {
    const profile = { vertical: 'home_services', callerMemory: { ...alvinCard } };
    const asked = turn(createBrainState(profile), 'Hello', profile);
    asked.caller.fileNameAskSpoken = true;
    const said = turn(asked, 'This is Alvin speaking.', profile);
    assert.equal(said.caller.name, 'Alvin');
    assert.notEqual(said.caller.name, 'Alvin speaking');
    assert.equal(said.caller.nameConfirmed, true);
    assert.equal(said.entities.name.value, 'Alvin');
    assert.equal(fileNameAskLine(said), '');
    assert.equal(extractName('This is Alvin speaking.'), 'Alvin');
  });

  it('asks the file name after a finished greeting and keeps it for the note', async () => {
    const profile = { vertical: 'home_services', afterHoursMode: 'serve', callerMemory: { ...alvinCard } };
    const caps = {
      escalate: true,
      createAppointment: true,
      createServiceRequest: true,
      saveCallerInfo: true,
    };
    const booking = turn(
      createBrainState(profile),
      'I want carpet cleaning around ABC tomorrow at Westlands at 9:00 AM',
      profile
    );
    const gate = planCallerModelTurn(booking, {
      greetingBarged: false,
      fileNameAskCommitted: false,
    });
    assert.equal(gate.runModel, false);
    assert.equal(gate.line, 'Am I speaking with Alvin?');
    assert.doesNotMatch(gate.line, /May I have your name|name, please|carpet|visit|tomorrow/i);

    booking.caller.fileNameAskSpoken = true;
    const heard = turn(booking, 'Uh, Alvin.', profile);
    assert.equal(heard.caller.name, 'Alvin');
    assert.notEqual(heard.caller.name, 'Uh Alvin');
    assert.equal(heard.caller.nameConfirmed, true);
    assert.equal(heard.entities.name.source, 'caller_file');
    assert.equal(fileNameAskLine(heard), '');

    const yesBranch = turn(booking, "Yes, you're speaking with Alvin.", profile);
    assert.equal(yesBranch.caller.name, 'Alvin');
    assert.equal(yesBranch.caller.nameConfirmed, true);

    const timePhrase = turn(booking, 'Ataround', profile);
    assert.notEqual(timePhrase.caller.name, 'Ataround');
    assert.equal(timePhrase.caller.nameConfirmed, false);

    let state = heard;
    state = turn(state, 'what else do you offer?', profile);
    state = turn(state, 'window cleaning', profile);
    state = turn(state, 'do you remember my name?', profile);
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.caller.nameConfirmed, true);
    assert.equal(fileNameAskLine(state), '');
    const rememberPrompt = formatBrainStateForPrompt(state);
    assert.doesNotMatch(rememberPrompt, /May I have your name|Tell me your name|Ask once for their name|Ask once: Am I speaking/i);
    assert.match(
      guardSpokenReply('Yes, you are Alvin.', {
        state,
        callerTurns: ['do you remember my name?'],
        language: 'en',
      }),
      /Alvin/
    );
    assert.equal(
      guardSpokenReply('Tell me your name so I can reach the team for you.', {
        state,
        callerTurns: ['do you remember my name?'],
        language: 'en',
      }),
      'Yes, you are Alvin.'
    );

    const note = 'Make a note for the team to contact me urgently about the window cleaning';
    state = turn(state, note, profile);
    assert.equal(state.caller.name, 'Alvin');
    assert.equal(state.intent, 'human');
    const decision = determineNextBestAction({ state, capabilities: caps });
    assert.notEqual(decision.slot, 'name');
    assert.doesNotMatch(String(decision.reason || ''), /May I have your name|Tell me your name|Ask once for their name/i);
    state = setNextBestAction(state, decision);
    const notePrompt = formatBrainStateForPrompt(state);
    assert.doesNotMatch(notePrompt, /May I have your name|Tell me your name|Ask once for their name|what is your name/i);
    assert.equal(fileNameAskLine(state), '');
    const noteSpeech = guardSpokenReply('Tell me your name so I can reach the team for you.', {
      state,
      callerTurns: [note],
      language: 'en',
    });
    assert.doesNotMatch(noteSpeech, /your name|May I have your name|name, please/i);

    const injected = ensureRequiredEscalate({}, state, caps);
    assert.equal(injected.escalate.name, 'Alvin');
    assert.doesNotMatch(String(injected.escalate.reason || ''), /^$/);

    let escalatedName = null;
    const execution = await executeBrainTools({
      parsed: {
        escalate: { teammate: 'owner', name: '', reason: note },
      },
      capabilities: caps,
      nameConfirmed: true,
      heldCallerName: state.caller.name,
      handlers: {
        escalate: async (info) => {
          escalatedName = info.name;
          return { ok: true, channel: 'whatsapp' };
        },
      },
    });
    assert.equal(escalatedName, 'Alvin');
    const spoken = formatToolConfirmation(execution.results, 'en');
    assert.doesNotMatch(spoken, /your name|May I have your name/i);
  });
});
