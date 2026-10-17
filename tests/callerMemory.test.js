const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  attachCallerMemory,
  bindCallerMemoryCard,
  buildCallerMemoryCard,
  formatReturningCallerForPrompt,
  seedCallerFromMemory,
  selectOpenVisitsForPrompt,
} = require('../src/conversation/callerMemory');
const { createBrainState, formatBrainStateForPrompt } = require('../src/conversation/brainState');
const { buildSystemPrompt } = require('../src/prompts');

// BRAIN_CALL_FIXES_D199=on (HD_1677e57f73f9 item 3): a past-dated requested
// visit is only in the past_open count line, never read as open.
const PAST_RULE = () => require('../src/conversation/callFixesD199').callFixesD199Enabled();
const PAST_ONE = 'There is one past-dated request the team still has to confirm.';

describe('returning-caller card', () => {
  it('builds a named unique-line card from contact plus open work', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'held Atomic Habits for Saturday',
        notes: 'prefers afternoon',
        metadata: { alternate_names: [] },
      },
      openRequests: [
        { request_type: 'hold', item: 'Atomic Habits', when_text: 'Saturday' },
      ],
      nextAppointment: {
        service_name: 'geyser repair',
        when_text: 'tomorrow morning',
      },
    });
    assert.equal(card.greetByName, true);
    assert.equal(card.sharedLine, false);
    assert.equal(card.name, 'Jane');
    assert.match(card.lastReason, /Atomic Habits/);
    assert.equal(card.openRequests.length, 1);
    assert.match(card.nextAppointment, /geyser repair/);
  });

  it('treats alternate names as a shared line and will not greet by name', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'price on soap',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
    });
    assert.equal(card.sharedLine, true);
    assert.equal(card.greetByName, false);
    const block = formatReturningCallerForPrompt(card);
    assert.match(block, /RETURNING CALLER/);
    assert.match(block, /shared line/i);
    assert.match(block, /who is speaking/i);
    assert.doesNotMatch(block, /use this name/i);
  });

  it('strips transcript-like notes from the card', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000003',
        name: 'Jane',
        last_reason: 'Caller: hi\nAgent: hello',
        notes: 'Caller: I need soap\nAgent: sure',
        metadata: {},
      },
    });
    assert.equal(card.lastReason, null);
    assert.equal(card.notes, null);
    const block = formatReturningCallerForPrompt(card);
    assert.doesNotMatch(block, /Caller:/);
    assert.doesNotMatch(block, /Agent:/);
  });

  it('omits the prompt block when there is no card', () => {
    assert.equal(formatReturningCallerForPrompt(null), '');
    assert.equal(buildCallerMemoryCard({ contact: null }), null);
    const prompt = buildSystemPrompt({ businessName: 'Acme' });
    assert.doesNotMatch(prompt, /RETURNING CALLER/);
  });

  it('injects the card as a candidate and does not seed the previous speaker', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'held Atomic Habits for Saturday',
        metadata: {},
      },
    });
    const prompt = buildSystemPrompt({
      businessName: 'Chapter One',
      callerMemory: card,
    });
    assert.match(prompt, /RETURNING CALLER/);
    assert.match(prompt, /Jane/);
    assert.match(prompt, /not bound/i);
    assert.match(prompt, /who is speaking/i);
    assert.doesNotMatch(prompt, /Atomic Habits/);
    const block = formatReturningCallerForPrompt(card);
    assert.doesNotMatch(block, /returning caller; use this name/i);
    assert.doesNotMatch(block, /First reasoned turn/);

    const state = createBrainState({ callerMemory: card });
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    assert.equal(state.caller.phone, '+254700000001');
    assert.equal(state.returning.identityBound, false);
    assert.equal(state.returning.nextVisit, null);
    assert.equal(state.returning.lastReason, null);
    assert.match(formatBrainStateForPrompt(state), /not bound/);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /Got it, Jane/);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /open visit/i);
  });

  it('does not seed a name on a shared line', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
    });
    const state = createBrainState({ callerMemory: card });
    assert.equal(state.caller.name, null);
    assert.equal(state.caller.nameConfirmed, false);
    const seeded = seedCallerFromMemory({ name: null, nameConfirmed: false }, card);
    assert.equal(seeded.name, null);
    assert.equal(seeded.nameConfirmed, false);
  });

  it('attaches a card from call phone without throwing when lookup fails', async () => {
    const profile = { id: 'tenant-1' };
    await attachCallerMemory(profile, {
      callSid: 'CA1',
      getCall: async () => ({ tenant_id: 'tenant-1', from_number: '+254700000001' }),
      getCallerMemory: async () => {
        throw new Error('boom');
      },
    });
    assert.equal(profile.callerMemory, undefined);

    const named = { id: 'tenant-1' };
    await attachCallerMemory(named, {
      callSid: 'CA2',
      getCall: async () => ({ tenant_id: 'tenant-1', from_number: '+254700000001' }),
      getCallerMemory: async () =>
        buildCallerMemoryCard({
          contact: { phone: '+254700000001', name: 'Jane', metadata: {} },
        }),
    });
    assert.equal(named.callerMemory.name, 'Jane');

    const stale = { id: 'tenant-1', callerMemory: { name: 'Stale' } };
    await attachCallerMemory(stale, {
      callSid: 'CA3',
      getCall: async () => ({ tenant_id: 'tenant-1', from_number: '+254700000009' }),
      getCallerMemory: async () => null,
    });
    assert.equal(stale.callerMemory, undefined);
  });

  it('answers hello on an unbound unique line without using the open visit', () => {
    const { observeCallerTurn, inferIntent } = require('../src/conversation/brainState');
    const { extractConversationEntities } = require('../src/conversation/entityExtraction');
    const { determineNextBestAction } = require('../src/conversation/nextBestAction');
    const { pickPhaticReply } = require('../src/conversation/dynamicSpeech');
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Alex',
        last_reason: 'carpet Tuesday',
        metadata: {},
      },
      nextAppointment: {
        service_name: 'carpet cleaning',
        when_text: 'Tuesday 10 AM',
      },
    });
    assert.doesNotMatch(formatReturningCallerForPrompt(card), /create_appointment unless they ask for a new job/);
    assert.match(formatReturningCallerForPrompt(card), /not bound/i);
    assert.doesNotMatch(formatReturningCallerForPrompt(card), /carpet cleaning/);
    assert.equal(
      pickPhaticReply({ language: 'en', callerMemory: card }),
      "I'm well. Who is calling?"
    );

    const profile = { vertical: 'home_services', callerMemory: card };
    const seeded = createBrainState(profile);
    assert.doesNotMatch(formatBrainStateForPrompt(seeded), /open visit/i);
    assert.match(formatBrainStateForPrompt(seeded), /not bound/);

    const hello = observeCallerTurn(seeded, {
      text: 'Hello',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    const who = determineNextBestAction({
      state: hello,
      capabilities: { createServiceRequest: true, createAppointment: true },
    });
    assert.equal(who.action, 'ASK_CLARIFICATION');
    assert.equal(who.slot, 'name');
    assert.match(who.reason, /Am I speaking with Alex/i);
    assert.match(who.reason, /Do not say nothing is open/i);
    assert.doesNotMatch(who.reason, /carpet/i);

    const named = observeCallerTurn(seeded, {
      text: 'My name is Alex',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('My name is Alex', {
        profile,
        state: seeded,
      }),
    });
    assert.equal(named.caller.name, 'Alex');
    assert.equal(named.caller.nameConfirmed, true);
    assert.equal(named.returning.fileRole, 'primary');
    assert.equal(named.returning.nextVisit, 'carpet cleaning');
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /Open: visit \| carpet cleaning/);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /unless the caller asks/);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /one sentence each, then one question/);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /Treat CALL STATE as fact/);
    assert.doesNotMatch(formatReturningCallerForPrompt(profile.callerMemory), /no booking/i);
    assert.doesNotMatch(formatReturningCallerForPrompt(profile.callerMemory), /nothing on file/i);
    assert.match(formatBrainStateForPrompt(named), /open visit/i);
    assert.equal(
      pickPhaticReply({ language: 'en', callerMemory: profile.callerMemory }),
      "I'm well. I have your visit on file. Is that why you called?"
    );

    assert.equal(
      inferIntent('Move my visit to Friday', { returning: named.returning }),
      'cancellation'
    );
    assert.equal(
      inferIntent('Need carpet cleaning tomorrow Rongai', {
        vertical: 'home_services',
        returning: named.returning,
      }),
      'booking'
    );

    const moved = observeCallerTurn(named, {
      text: 'Move my visit to Friday',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    assert.equal(moved.intent, 'cancellation');
    const decision = determineNextBestAction({
      state: moved,
      capabilities: { createServiceRequest: true, createAppointment: true },
    });
    assert.equal(decision.action, 'ASK_CLARIFICATION');
    assert.equal(decision.slot, 'when');

    const vague = observeCallerTurn(named, {
      text: 'Calling about my visit',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    assert.equal(vague.intent, 'general_enquiry');
    const speakVisit = determineNextBestAction({
      state: vague,
      capabilities: { createServiceRequest: true },
    });
    assert.equal(speakVisit.action, 'ANSWER');
    assert.match(speakVisit.reason, /open visit/i);

    const bookings = observeCallerTurn(named, {
      text: 'What are my bookings?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    assert.equal(bookings.intent, 'general_enquiry');
    const speakBookings = determineNextBestAction({
      state: bookings,
      capabilities: { createServiceRequest: true, createAppointment: true },
    });
    assert.equal(speakBookings.action, 'ANSWER');
    assert.match(speakBookings.reason, /open visit|recent bookings/i);
    assert.notEqual(speakBookings.action, 'CREATE_REQUEST');
  });

  it('binds the household file after the primary name is confirmed on a shared line', () => {
    const { observeCallerTurn } = require('../src/conversation/brainState');
    const { extractConversationEntities } = require('../src/conversation/entityExtraction');
    const { determineNextBestAction } = require('../src/conversation/nextBestAction');
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'carpet Tuesday',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
      nextAppointment: {
        service_name: 'carpet cleaning',
        when_text: 'Tuesday 10 AM',
      },
    });
    const profile = { vertical: 'home_services', callerMemory: card };
    const seeded = createBrainState(profile);
    assert.equal(seeded.caller.name, null);
    assert.match(formatBrainStateForPrompt(seeded), /Do not ask who is speaking/);
    assert.match(formatBrainStateForPrompt(seeded), /Do not use the file name/);
    assert.doesNotMatch(formatReturningCallerForPrompt(card), /use this name/i);

    const named = observeCallerTurn(seeded, {
      text: 'My name is Amina',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('My name is Amina', {
        profile,
        state: seeded,
      }),
    });
    assert.equal(named.caller.name, 'Amina');
    assert.equal(named.caller.nameConfirmed, true);
    assert.equal(named.returning.fileRole, 'primary');
    assert.equal(named.returning.nextVisit, 'carpet cleaning');
    assert.match(formatBrainStateForPrompt(named), /open visit/i);
    assert.doesNotMatch(formatBrainStateForPrompt(named), /Ask who is speaking/);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /use this name/i);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /carpet cleaning/);
    const { pickPhaticReply } = require('../src/conversation/dynamicSpeech');
    assert.equal(
      pickPhaticReply({ language: 'en', callerMemory: profile.callerMemory }),
      "I'm well. I have your visit on file. Is that why you called?"
    );

    const aboutVisit = observeCallerTurn(named, {
      text: 'Calling about my visit',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    assert.equal(aboutVisit.intent, 'general_enquiry');
    const decision = determineNextBestAction({
      state: aboutVisit,
      capabilities: { createServiceRequest: true },
    });
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /open visit/i);
  });

  it('does not attach the household visit when an alternate speaks on a shared line', () => {
    const { observeCallerTurn } = require('../src/conversation/brainState');
    const { extractConversationEntities } = require('../src/conversation/entityExtraction');
    const { determineNextBestAction } = require('../src/conversation/nextBestAction');
    const { pickPhaticReply } = require('../src/conversation/dynamicSpeech');
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'carpet Tuesday',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
      nextAppointment: {
        service_name: 'carpet cleaning',
        when_text: 'Tuesday 10 AM',
      },
    });
    const profile = { vertical: 'home_services', callerMemory: card };
    const seeded = createBrainState(profile);
    const named = observeCallerTurn(seeded, {
      text: 'My name is Brian',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('My name is Brian', {
        profile,
        state: seeded,
      }),
    });
    assert.equal(named.caller.name, 'Brian');
    assert.equal(named.caller.nameConfirmed, true);
    assert.equal(named.returning.fileRole, 'alternate');
    assert.equal(named.returning.nextVisit, null);
    assert.equal(named.returning.lastReason, null);
    assert.match(formatBrainStateForPrompt(named), /not the household file/i);
    assert.doesNotMatch(formatBrainStateForPrompt(named), /Ask who is speaking/);
    assert.doesNotMatch(formatReturningCallerForPrompt(profile.callerMemory), /carpet cleaning/);
    assert.equal(
      pickPhaticReply({ language: 'en', callerMemory: profile.callerMemory }),
      "I'm well, thanks. How can I help?"
    );

    const aboutVisit = observeCallerTurn(named, {
      text: 'Calling about my visit',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    const decision = determineNextBestAction({
      state: aboutVisit,
      capabilities: { createServiceRequest: true, createAppointment: true },
    });
    assert.notEqual(decision.reason, undefined);
    assert.doesNotMatch(String(decision.reason), /open visit/i);
  });

  it('restores the household file if the primary speaks after an alternate on the same call', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'carpet Tuesday',
        metadata: { alternate_names: [{ name: 'Brian' }] },
      },
      nextAppointment: { service_name: 'carpet cleaning', when_text: 'Tuesday' },
      recentAppointments: [
        { id: 'old-1', service_name: 'couch cleaning', when_text: 'March', status: 'done' },
      ],
    });
    const asBrian = bindCallerMemoryCard(card, 'Brian');
    assert.equal(asBrian.fileRole, 'alternate');
    assert.equal(asBrian.nextAppointment, null);
    assert.deepEqual(asBrian.recentBookings, []);
    const asAmina = bindCallerMemoryCard(asBrian, 'Amina');
    assert.equal(asAmina.fileRole, 'primary');
    assert.match(asAmina.nextAppointment, /carpet cleaning/);
    assert.match(asAmina.recentBookings.join(' '), /couch cleaning/);
    assert.equal(bindCallerMemoryCard(asAmina, 'Amina'), asAmina);
  });

  it('does not give a unique-line visit to a different spoken name', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'held Atomic Habits for Saturday',
        metadata: {},
      },
      nextAppointment: { service_name: 'geyser repair', when_text: 'tomorrow' },
    });
    const bound = bindCallerMemoryCard(card, 'Brian');
    assert.equal(bound.fileRole, 'other');
    assert.equal(bound.nextAppointment, null);
    assert.equal(bound.lastReason, null);
    const jane = bindCallerMemoryCard(card, 'Jane');
    assert.equal(jane.fileRole, 'primary');
    assert.match(jane.nextAppointment, /geyser repair/);
  });

  it('puts two previous bookings on the live file without listing them as a menu', () => {
    const { observeCallerTurn, inferIntent } = require('../src/conversation/brainState');
    const { determineNextBestAction } = require('../src/conversation/nextBestAction');
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'carpet Tuesday',
        metadata: {},
      },
      nextAppointment: {
        id: 'appt-next',
        service_name: 'mattress clean',
        when_text: 'Friday',
      },
      recentAppointments: [
        { id: 'appt-next', service_name: 'mattress clean', when_text: 'Friday', status: 'requested' },
        { id: 'appt-1', service_name: 'carpet cleaning', when_text: 'last Tuesday', status: 'done' },
        { id: 'appt-2', service_name: 'couch cleaning', when_text: '3 March', status: 'done' },
        { id: 'appt-3', service_name: 'fumigation', when_text: 'January', status: 'done' },
      ],
    });
    assert.deepEqual(card.recentBookings, [
      'carpet cleaning | done',
      'couch cleaning | done',
    ]);
    assert.doesNotMatch(card.recentBookings.join(' '), /mattress clean/);
    const unboundBlock = formatReturningCallerForPrompt(card);
    assert.match(unboundBlock, /not bound/i);
    assert.doesNotMatch(unboundBlock, /History:/);
    assert.doesNotMatch(unboundBlock, /carpet cleaning/);

    const profile = { vertical: 'home_services', callerMemory: card };
    const unbound = createBrainState(profile);
    assert.doesNotMatch(formatBrainStateForPrompt(unbound), /recent carpet cleaning/);

    const { extractConversationEntities } = require('../src/conversation/entityExtraction');
    const state = observeCallerTurn(unbound, {
      text: 'My name is Jane',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
      entities: extractConversationEntities('My name is Jane', {
        profile,
        state: unbound,
      }),
    });
    const block = formatReturningCallerForPrompt(profile.callerMemory);
    assert.match(block, /History: carpet cleaning \| done/);
    assert.match(block, /History: couch cleaning \| done/);
    assert.match(block, /History only if they mention that job/);
    assert.doesNotMatch(block, /fumigation/);
    assert.match(formatBrainStateForPrompt(state), /Caller file history:.*carpet cleaning/);
    assert.equal(
      inferIntent('Last time you came for carpet', { returning: state.returning }),
      'general_enquiry'
    );
    const asked = observeCallerTurn(state, {
      text: 'Last time you came for carpet',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
      profile,
    });
    const decision = determineNextBestAction({
      state: asked,
      capabilities: { createAppointment: true },
    });
    assert.equal(decision.action, 'ANSWER');
    assert.match(decision.reason, /recent bookings/i);
    assert.match(decision.reason, /Do not read them as a list/);

    const asOther = bindCallerMemoryCard(card, 'Brian');
    assert.deepEqual(asOther.recentBookings, []);
  });

  it('hides this phone file visit from OPEN VISITS until the speaker is bound', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        metadata: {},
      },
    });
    const visits = [
      {
        when_text: 'Tue 10 AM',
        service_name: 'Carpet',
        status: 'requested',
        caller_phone: '+254700000001',
      },
      {
        when_text: 'Wed 2 PM',
        service_name: 'Sofa',
        status: 'requested',
        caller_phone: '+254700000099',
      },
    ];
    const pending = selectOpenVisitsForPrompt(visits, card);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].service_name, 'Sofa');

    const bound = bindCallerMemoryCard(card, 'Jane');
    const owned = selectOpenVisitsForPrompt(visits, bound);
    assert.equal(owned.length, 2);

    const other = bindCallerMemoryCard(card, 'Brian');
    const stripped = selectOpenVisitsForPrompt(visits, other);
    assert.equal(stripped.length, 1);
    assert.equal(stripped[0].service_name, 'Sofa');
  });

  it('formats a bound lived file as labeled Open Last History Place rows', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'carpet Tuesday',
        notes: 'prefers morning',
        metadata: {
          caller_profile: {
            standing: 'Usually carpet. Morning. Kiswahili.',
            language: 'sw',
            typical_job: 'carpet cleaning',
            landmark: 'Rongai',
          },
        },
      },
      openRequests: [
        { request_type: 'hold', item: 'Atomic Habits', when_text: 'Saturday' },
      ],
      nextAppointment: {
        service_name: 'mattress clean',
        when_text: 'Friday',
        status: 'requested',
        address_landmark: 'Rongai',
      },
      recentAppointments: [
        {
          id: 'appt-1',
          service_name: 'carpet cleaning',
          when_text: 'last Tuesday',
          status: 'done',
          address_landmark: 'Rongai',
        },
        {
          id: 'appt-2',
          service_name: 'carpet cleaning',
          when_text: 'March',
          status: 'done',
        },
      ],
    });
    assert.equal(card.place, 'Rongai');
    assert.equal(card.usualJob, 'carpet cleaning');
    assert.equal(card.language, 'sw');
    assert.match(card.nextAppointment, /mattress clean \| requested \| Rongai/);
    assert.equal(card.openRequests[0], 'hold | Atomic Habits');

    const unbound = formatReturningCallerForPrompt(card);
    assert.doesNotMatch(unbound, /Open:/);
    assert.doesNotMatch(unbound, /History:/);
    assert.doesNotMatch(unbound, /Place:/);

    const bound = bindCallerMemoryCard(card, 'Jane');
    const block = formatReturningCallerForPrompt(bound);
    assert.match(block, /Speaker: Jane \(bound; use this name\)/);
    assert.match(block, /Open: visit \| mattress clean \| requested \| Rongai/);
    assert.match(block, /Open: hold \| Atomic Habits/);
    assert.match(block, /Last: carpet Tuesday/);
    assert.match(block, /History: carpet cleaning \| done \| Rongai/);
    assert.match(block, /Place: Rongai/);
    assert.match(block, /Usual: carpet cleaning/);
    assert.match(block, /Standing: Usually carpet. Morning. Kiswahili./);
    assert.match(block, /Language: sw/);
    assert.match(block, /Note: prefers morning/);
    assert.match(block, /unless the caller asks/);
    assert.match(block, /one sentence each, then one question/);
    assert.match(block, /Treat CALL STATE as fact/);
    assert.doesNotMatch(block, /no booking/i);
    assert.doesNotMatch(block, /nothing on file/i);
    assert.doesNotMatch(block, /Caller:/);

    const state = createBrainState({ callerMemory: bound });
    const callState = formatBrainStateForPrompt(state);
    assert.match(callState, /Caller file speaker: Jane \(bound\)/);
    assert.match(callState, /Caller file open visit: mattress clean/);
    assert.match(callState, /Caller file open request: hold \| Atomic Habits/);
    assert.match(callState, /Caller file history:.*carpet cleaning/);
    assert.match(callState, /Caller file place: Rongai/);
  });

  it('does not copy household standing onto an alternate speaker', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254700000002',
        name: 'Amina',
        last_reason: 'carpet Tuesday',
        metadata: {
          alternate_names: [{ name: 'Brian' }],
          caller_profile: {
            standing: 'Usually carpet.',
            persons: {
              brian: { standing: 'Asks about soaps.', language: 'en' },
            },
          },
        },
      },
      nextAppointment: { service_name: 'carpet cleaning', when_text: 'Tuesday' },
    });
    const asBrian = bindCallerMemoryCard(card, 'Brian');
    assert.equal(asBrian.nextAppointment, null);
    assert.equal(asBrian.standing, 'Asks about soaps.');
    assert.equal(asBrian.language, 'en');
    const brianBlock = formatReturningCallerForPrompt(asBrian);
    assert.match(brianBlock, /Standing: Asks about soaps./);
    assert.doesNotMatch(brianBlock, /Open:/);
    assert.doesNotMatch(brianBlock, /carpet cleaning/);

    const asAmina = bindCallerMemoryCard(asBrian, 'Amina');
    assert.match(asAmina.nextAppointment, /carpet cleaning/);
    assert.equal(asAmina.standing, 'Usually carpet.');
  });

  it('does not offer a long-past booking as tomorrow', () => {
    const now = new Date('2026-09-30T08:00:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'visit, carpet cleaning, tomorrow morning, Rongai',
        metadata: {},
      },
      nextAppointment: {
        id: 'old-visit',
        service_name: 'carpet cleaning',
        when_text: 'tomorrow morning',
        status: 'requested',
        address_landmark: 'Rongai',
        created_at: '2026-06-01T06:00:00.000Z',
      },
    });
    if (PAST_RULE()) {
      assert.equal(card.nextAppointment, null);
      assert.deepEqual(card.openVisits, []);
      assert.equal(card.pastOpenCount, 1);
      assert.doesNotMatch(card.lastReason, /\b(tomorrow|today|kesho|leo)\b/i);
      const pastBlock = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Jane'));
      assert.doesNotMatch(pastBlock, /Open: visit/);
      assert.match(pastBlock, /Past-dated, not confirmed: 1 row/);
      assert.doesNotMatch(pastBlock, /\b(tomorrow|today|kesho|leo)\b/i);
      return;
    }
    assert.match(card.nextAppointment, /carpet cleaning/i);
    assert.doesNotMatch(card.nextAppointment, /\b(tomorrow|today|kesho|leo|past)\b/i);
    assert.doesNotMatch(card.openVisits[0], /\b(tomorrow|today|kesho|leo|past)\b/i);
    assert.doesNotMatch(card.openVisits.join(' '), /\b(tomorrow|today|kesho|leo)\b/i);
    assert.doesNotMatch(card.lastReason, /\b(tomorrow|today|kesho|leo)\b/i);
    assert.match(card.lastReason, /past/i);
    const block = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Jane'));
    assert.match(block, /Open: visit/);
    assert.match(block, /past/i);
    assert.doesNotMatch(block, /\b(tomorrow|today|kesho|leo)\b/i);
    const state = createBrainState({ callerMemory: bindCallerMemoryCard(card, 'Jane') });
    assert.doesNotMatch(state.returning.nextVisit, /\b(tomorrow|today|past)\b/i);
    assert.match(formatBrainStateForPrompt(state), /open visit/i);
    assert.doesNotMatch(formatBrainStateForPrompt(state), /\btomorrow\b/i);
  });

  it('calls a visit today when it was saved as tomorrow and the window is today', () => {
    const now = new Date('2026-09-30T05:00:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        last_reason: 'visit tomorrow at 10 AM',
        metadata: {},
      },
      nextAppointment: {
        service_name: 'carpet cleaning',
        when_text: 'tomorrow at 10 AM',
        status: 'confirmed',
        window_start: '2026-09-30T07:00:00.000Z',
      },
    });
    assert.match(card.nextAppointment, /today at 10 AM/);
    assert.doesNotMatch(card.nextAppointment, /tomorrow/);
    assert.match(card.lastReason, /today at 10 AM/);
    assert.doesNotMatch(card.lastReason, /tomorrow/);
  });

  it('keeps tomorrow when the window is actually tomorrow', () => {
    const now = new Date('2026-09-30T05:00:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        metadata: {},
      },
      nextAppointment: {
        service_name: 'carpet cleaning',
        when_text: 'tomorrow at 10 AM',
        status: 'requested',
        window_start: '2026-10-01T07:00:00.000Z',
      },
    });
    assert.match(card.nextAppointment, /tomorrow at 10 AM/);
  });

  it('prefers a later upcoming visit over a newer booking whose date has passed', () => {
    const now = new Date('2026-09-30T08:00:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        metadata: {},
      },
      nextAppointment: {
        id: 'stale',
        service_name: 'carpet cleaning',
        when_text: 'tomorrow morning',
        status: 'requested',
        created_at: '2026-06-02T06:00:00.000Z',
      },
      recentAppointments: [
        {
          id: 'ahead',
          service_name: 'sofa cleaning',
          when_text: 'Friday at 2 PM',
          status: 'confirmed',
          window_start: '2026-10-02T11:00:00.000Z',
        },
      ],
    });
    assert.match(card.nextAppointment, /sofa cleaning/);
    assert.doesNotMatch(card.nextAppointment, /tomorrow/);
    if (PAST_RULE()) {
      assert.doesNotMatch(card.openVisits.join(' '), /carpet cleaning/i);
      assert.equal(card.pastOpenCount, 1);
    } else {
      assert.match(card.openVisits.join(' '), /carpet cleaning/i);
    }
    assert.doesNotMatch(card.openVisits.join(' '), /\b(tomorrow|past)\b/i);
    assert.doesNotMatch(card.recentBookings.join(' '), /\btomorrow\b/i);
  });

  it('after a yes, names two open items and does not teach a denial', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254790381872',
        name: 'Alvin',
        metadata: {},
      },
      openRequests: [
        { request_type: 'request', item: 'carpet cleaning', when_text: 'tomorrow' },
        { request_type: 'request', item: 'carpet cleaning', when_text: 'tomorrow' },
      ],
    });
    const unbound = formatReturningCallerForPrompt(card);
    assert.match(unbound, /Am I speaking with Alvin/);
    assert.match(unbound, /Do not talk about visits yet/);
    assert.match(unbound, /do not read this file/);
    assert.doesNotMatch(unbound, /no booking/i);
    assert.doesNotMatch(unbound, /nothing on file/i);
    assert.doesNotMatch(unbound, /carpet cleaning/);

    const notThem = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Brian'));
    assert.match(notThem, /not the household file/i);
    assert.doesNotMatch(notThem, /carpet cleaning/);
    assert.doesNotMatch(notThem, /Open:/);

    const yes = bindCallerMemoryCard(card, 'Alvin');
    const block = formatReturningCallerForPrompt(yes);
    assert.equal(
      (block.match(/Open: request \| carpet cleaning/g) || []).length,
      2
    );
    assert.match(block, /say each still-open line \(job, when, place; only fields present\), one sentence each, then one question/);
    assert.match(block, /Treat CALL STATE as fact/);
    assert.doesNotMatch(block, /no booking/i);
    assert.doesNotMatch(block, /nothing on file/i);

    const state = createBrainState({ callerMemory: yes });
    const callState = formatBrainStateForPrompt(state);
    assert.equal(
      (callState.match(/Caller file open request: request \| carpet cleaning/g) || []).length,
      2
    );
    assert.match(callState, /unless the caller asks/);
    assert.match(callState, /one sentence each, then one question/);
    assert.match(callState, /Treat CALL STATE as fact/);
    assert.doesNotMatch(callState, /no booking/i);
    assert.doesNotMatch(callState, /nothing on file/i);

    const cleared = {
      ...yes,
      openRequests: [],
      openVisits: [],
      nextAppointment: null,
    };
    const afterCancel = formatReturningCallerForPrompt(cleared);
    assert.doesNotMatch(afterCancel, /no booking/i);
    assert.doesNotMatch(afterCancel, /nothing on file/i);
    assert.doesNotMatch(afterCancel, /Open:/);
    const rules = buildSystemPrompt({ businessName: 'Scalers', agentName: 'A' });
    assert.match(rules, /Do not talk about visits yet/);
    assert.match(rules, /Ask once: Am I speaking with that name/);
    assert.match(rules, /If they ask and those lines are gone, you may say nothing is still open/);
    assert.match(rules, /Do not read open visits, holds, callbacks, or orders on that turn/);
    assert.match(rules, /Read those lines only when they ask about them/);
    assert.doesNotMatch(rules, /no booking/i);
    assert.doesNotMatch(rules, /nothing on file/i);

    const confirmedTurn = buildSystemPrompt({
      businessName: 'Scalers',
      agentName: 'A',
      callerMemory: yes,
    });
    assert.match(confirmedTurn, /Alvin \(bound; use this name\)/);
    assert.match(confirmedTurn, /Open: request \| carpet cleaning/);
    assert.match(
      confirmedTurn,
      /If you append ONLY save_caller_info, you MUST speak your natural response\. Do not read open visits, holds, callbacks, or orders unless they just asked about them/
    );
    assert.match(
      confirmedTurn,
      /If you append create_service_request, create_appointment, or update_appointment, speak nothing/
    );
    assert.match(
      confirmedTurn,
      /If you append create_appointment or update_appointment, speak nothing/
    );
    assert.doesNotMatch(confirmedTurn, /If you append any tool this turn, speak nothing/);
    assert.match(callState, /unless the caller asks/);
    assert.match(callState, /Treat CALL STATE as fact/);
    assert.doesNotMatch(confirmedTurn, /no booking/i);
    assert.doesNotMatch(confirmedTurn, /nothing on file/i);
    assert.match(
      confirmedTurn,
      /say each still-open line \(job, when, place; only fields present\), one sentence each, then one question/
    );
  });

  it('names each still-open visit after confirm instead of filing the second as history', () => {
    const card = buildCallerMemoryCard({
      contact: {
        phone: '+254790381872',
        name: 'Alvin',
        metadata: {},
      },
      nextAppointment: {
        id: 'a',
        service_name: 'carpet cleaning',
        when_text: 'tomorrow',
        status: 'requested',
        address_landmark: 'Rongai',
      },
      recentAppointments: [
        {
          id: 'b',
          service_name: 'carpet cleaning',
          when_text: 'tomorrow',
          status: 'requested',
          address_landmark: 'Westlands',
        },
      ],
    });
    const yes = bindCallerMemoryCard(card, 'Alvin');
    const block = formatReturningCallerForPrompt(yes);
    assert.match(block, /Open: visit \| carpet cleaning \| requested \| Rongai/);
    assert.match(block, /Open: visit \| carpet cleaning \| requested \| Westlands/);
    assert.doesNotMatch(block, /History: carpet cleaning \| tomorrow/);
    assert.match(block, /unless the caller asks/);
    assert.match(block, /one sentence each, then one question/);
    assert.doesNotMatch(block, /no booking/i);
    assert.doesNotMatch(block, /nothing on file/i);
    const callState = formatBrainStateForPrompt(createBrainState({ callerMemory: yes }));
    assert.match(callState, /open visit: carpet cleaning \|(?: tomorrow \|)? requested \| Rongai/);
    assert.match(callState, /open visit: carpet cleaning \|(?: tomorrow \|)? requested \| Westlands/);
    assert.match(callState, /unless the caller asks/);
    assert.doesNotMatch(callState, /no booking/i);
    assert.doesNotMatch(callState, /nothing on file/i);
  });

  it('keeps a past-due open hold on the card', () => {
    const now = new Date('2026-09-30T08:00:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: {
        phone: '+254700000001',
        name: 'Jane',
        metadata: {},
      },
      openRequests: [
        {
          request_type: 'hold',
          item: 'Atomic Habits',
          status: 'open',
          when_text: 'tomorrow',
          created_at: '2026-06-01T06:00:00.000Z',
        },
      ],
    });
    assert.equal(card.openRequests.length, 1);
    assert.match(card.openRequests[0], /hold \| Atomic Habits/i);
    assert.doesNotMatch(card.openRequests[0], /\b(tomorrow|past)\b/i);
    assert.equal(card.openVisits.length, 0);
  });
});
