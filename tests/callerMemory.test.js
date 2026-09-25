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

  it('asks who is speaking on a unique line before using the open visit', () => {
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
    assert.match(who.reason, /who is speaking/i);

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
    assert.equal(named.returning.nextVisit, 'carpet cleaning | Tuesday 10 AM');
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /Open: visit \| carpet cleaning/);
    assert.match(formatReturningCallerForPrompt(profile.callerMemory), /Open first/);
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
    assert.match(formatBrainStateForPrompt(seeded), /Ask who is speaking/);
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
    assert.equal(named.returning.nextVisit, 'carpet cleaning | Tuesday 10 AM');
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
      'carpet cleaning | last Tuesday | done',
      'couch cleaning | 3 March | done',
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
    assert.match(block, /History: carpet cleaning \| last Tuesday \| done/);
    assert.match(block, /History: couch cleaning \| 3 March \| done/);
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
    assert.match(card.nextAppointment, /mattress clean \| Friday \| requested \| Rongai/);
    assert.equal(card.openRequests[0], 'hold | Atomic Habits | Saturday');

    const unbound = formatReturningCallerForPrompt(card);
    assert.doesNotMatch(unbound, /Open:/);
    assert.doesNotMatch(unbound, /History:/);
    assert.doesNotMatch(unbound, /Place:/);

    const bound = bindCallerMemoryCard(card, 'Jane');
    const block = formatReturningCallerForPrompt(bound);
    assert.match(block, /Speaker: Jane \(bound; use this name\)/);
    assert.match(block, /Open: visit \| mattress clean \| Friday \| requested \| Rongai/);
    assert.match(block, /Open: hold \| Atomic Habits \| Saturday/);
    assert.match(block, /Last: carpet Tuesday/);
    assert.match(block, /History: carpet cleaning \| last Tuesday \| done \| Rongai/);
    assert.match(block, /Place: Rongai/);
    assert.match(block, /Usual: carpet cleaning/);
    assert.match(block, /Standing: Usually carpet. Morning. Kiswahili./);
    assert.match(block, /Language: sw/);
    assert.match(block, /Note: prefers morning/);
    assert.match(block, /Open first/);
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
});
