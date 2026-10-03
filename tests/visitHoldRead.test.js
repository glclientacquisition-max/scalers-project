const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCallerMemoryCard,
  bindCallerMemoryCard,
  formatReturningCallerForPrompt,
} = require('../src/conversation/callerMemory');
const { createBrainState, observeCallerTurn } = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { hasReadableFile } = require('../src/conversation/fileRead');
const { looksLikePastBookingTalk } = require('../src/conversation/visitTalk');
const { extractName } = require('../src/conversation/entityExtraction');

const BOOKING_DENIAL = "I don't have a booking for you.";
const HOLD_DENIAL = "I don't have an order or a hold for you.";
const NOTHING_OPEN = 'Nothing is still open.';

function played(turn) {
  assert.equal(turn.local, null);
  return turn.state.conversation.fileReadSentence;
}

function heard(card, text, vertical = 'home_services') {
  const bound = bindCallerMemoryCard(card, card.name);
  const profile = { vertical, callerMemory: bound };
  const state = observeCallerTurn(createBrainState(profile), {
    text,
    profile,
    detectedLanguage: 'en',
    resolvedLanguage: 'en',
  });
  const local = resolveLocalReply({ text, state, profile, language: 'en' });
  assert.equal(local, null);
  return state.conversation.fileReadSentence;
}


function boundState(card, vertical) {
  const bound = bindCallerMemoryCard(card, card.name);
  return createBrainState({ vertical, callerMemory: bound });
}

describe('visit and hold read before the empty-file line', () => {
  it('does not deny a visit lookup when past-due requested rows and an upcoming visit are on the card', () => {
    const now = new Date('2026-10-03T12:37:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
      nextAppointment: {
        id: 'past-req',
        service_name: 'carpet cleaning',
        when_text: 'yesterday morning',
        status: 'requested',
        window_start: '2026-10-01T07:00:00.000Z',
        address_landmark: 'Rongai',
      },
      recentAppointments: [
        {
          id: 'upcoming',
          service_name: 'pet stain',
          when_text: 'tomorrow 10:00 AM',
          status: 'confirmed',
          window_start: '2026-10-04T07:00:00.000Z',
        },
      ],
    });
    assert.match(card.openVisits.join(' '), /carpet cleaning/i);
    assert.match(card.openVisits.join(' '), /pet stain/i);
    assert.match(card.nextAppointment, /pet stain/i);
    assert.match(card.openVisits.join(' '), /past/i);
    const state = boundState(card, 'home_services');
    assert.equal(hasReadableFile(state), true);
    const line = heard(card, "I'm inquiring about my bookings");
    assert.match(line, /You have pet stain, tomorrow 10:00 AM/);
    assert.match(line, /You have carpet cleaning, past/);
    assert.doesNotMatch(line, /these visits/i);
    assert.notEqual(line, BOOKING_DENIAL);
    const block = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Alvin'));
    assert.match(block, /Open: visit \| carpet cleaning/i);
    assert.match(block, /Open: visit \| pet stain/i);
    assert.match(block, /immediately say each still-open line/);
  });

  it('reads history for previous ones instead of the empty-file denial', () => {
    const card = buildCallerMemoryCard({
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
      recentAppointments: [
        {
          id: 'done-1',
          service_name: 'carpet cleaning',
          when_text: 'last Tuesday',
          status: 'done',
        },
      ],
    });
    assert.match(card.recentBookings.join(' '), /carpet cleaning/i);
    const state = boundState(card, 'home_services');
    assert.equal(looksLikePastBookingTalk('And my previous ones?'), true);
    const line = heard(card, 'And my previous ones?');
    assert.match(line, /You have carpet cleaning, last Tuesday/);
    assert.notEqual(line, BOOKING_DENIAL);
    const block = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Alvin'));
    assert.match(block, /History: carpet cleaning/i);
    const decision = determineNextBestAction({
      state: {
        ...state,
        intent: 'general_enquiry',
        conversation: { answersReceived: ['And my previous ones?'] },
        goal: { description: 'And my previous ones?' },
      },
      capabilities: { createAppointment: true },
    });
    assert.match(decision.reason, /recent bookings/i);
  });

  it('keeps a past-due open hold readable and does not speak the hold denial', () => {
    const now = new Date('2026-10-03T12:37:00.000Z');
    const card = buildCallerMemoryCard({
      now,
      contact: { phone: '+254700000001', name: 'Esga', metadata: {} },
      openRequests: [
        {
          id: 'hold-past',
          request_type: 'hold',
          item: 'Atomic Habits',
          status: 'open',
          when_text: 'tomorrow',
          window_start: '2026-06-02T07:00:00.000Z',
          created_at: '2026-06-01T06:00:00.000Z',
        },
      ],
    });
    assert.equal(card.openRequests.length, 1);
    assert.match(card.openRequests[0], /^hold \| Atomic Habits/i);
    assert.match(card.openRequests[0], /past/i);
    assert.doesNotMatch(card.openRequests.join(' '), /\btomorrow\b/i);
    assert.equal(card.openVisits.length, 0);
    assert.equal(card.recentBookings.length, 0);
    const unbound = createBrainState({ vertical: 'retail', callerMemory: card });
    assert.equal(
      resolveLocalReply({ text: 'What do I have on hold?', state: unbound, language: 'en' }),
      null
    );
    const state = boundState(card, 'retail');
    assert.equal(hasReadableFile(state), true);
    const line = heard(card, 'What do I have on hold?', 'retail');
    assert.match(line, /You have a Atomic Habits request, past/);
    assert.notEqual(line, HOLD_DENIAL);
    assert.notEqual(line, BOOKING_DENIAL);
    const block = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Esga'));
    assert.match(block, /Open: hold \| Atomic Habits/i);
    assert.match(block, /immediately say each still-open line/);
    assert.doesNotMatch(block, /I don't have an order or a hold for you/);
  });

  it('reads fulfilled and cancelled holds on previous hold or order', () => {
    const card = buildCallerMemoryCard({
      contact: { phone: '+254700000001', name: 'Esga', metadata: {} },
      openRequests: [
        {
          id: 'hold-done',
          request_type: 'hold',
          item: 'Atomic Habits',
          status: 'fulfilled',
          when_text: 'last Tuesday',
        },
        {
          id: 'order-cancelled',
          request_type: 'order',
          item: 'diaries',
          status: 'cancelled',
          when_text: '3 March',
        },
      ],
    });
    assert.equal(card.openRequests.length, 0);
    assert.match(card.recentBookings.join(' '), /hold \| Atomic Habits/i);
    assert.match(card.recentBookings.join(' '), /fulfilled/i);
    assert.match(card.recentBookings.join(' '), /order \| diaries/i);
    assert.match(card.recentBookings.join(' '), /cancelled/i);
    assert.equal(looksLikePastBookingTalk('What about my previous hold?'), true);
    assert.equal(looksLikePastBookingTalk('And my previous order?'), true);
    const state = boundState(card, 'retail');
    for (const text of ['What about my previous hold?', 'And my previous order?']) {
      const line = heard(card, text, 'retail');
      assert.match(line, /Atomic Habits|diaries/);
      assert.notEqual(line, HOLD_DENIAL);
      assert.notEqual(line, BOOKING_DENIAL);
    }
    const block = formatReturningCallerForPrompt(bindCallerMemoryCard(card, 'Esga'));
    assert.match(block, /History: hold \| Atomic Habits/i);
    assert.match(block, /History: order \| diaries/i);
    const decision = determineNextBestAction({
      state: {
        ...state,
        intent: 'general_enquiry',
        conversation: { answersReceived: ['What about my previous hold?'] },
        goal: { description: 'What about my previous hold?' },
      },
      capabilities: {},
    });
    assert.match(decision.reason, /recent bookings/i);
  });

  it('says nothing is still open when nothing is open and nothing is recent', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../src/conversation/fileRead.js'),
      'utf8'
    );
    assert.match(src, /Nothing is still open\./);
    assert.match(src, /I don't have a booking for you\./);
    assert.match(src, /I don't have an order or a hold for you\./);
    assert.doesNotMatch(src, /I don't see any holds/i);
    assert.doesNotMatch(src, /no bookings on file/i);
    const card = buildCallerMemoryCard({
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
    });
    assert.equal(card.openVisits.length, 0);
    assert.equal(card.openRequests.length, 0);
    assert.equal(card.recentBookings.length, 0);
    const bound = bindCallerMemoryCard(card, 'Alvin');
    const profile = { vertical: 'home_services', callerMemory: bound };
    let state = observeCallerTurn(createBrainState(profile), {
      text: "I'm inquiring about my bookings",
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    let local = resolveLocalReply({
      text: "I'm inquiring about my bookings",
      state,
      profile,
      language: 'en',
    });
    assert.equal(local, null);
    assert.equal(state.conversation.fileReadSentence, NOTHING_OPEN);
    state = observeCallerTurn(state, {
      text: 'Really?',
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    local = resolveLocalReply({ text: 'Really?', state, profile, language: 'en' });
    assert.equal(local, null);
    assert.equal(state.conversation.fileReadSentence, NOTHING_OPEN);
    assert.notEqual(state.conversation.fileReadSentence, BOOKING_DENIAL);
    assert.equal(heard(card, 'What do I have on hold?', 'retail'), NOTHING_OPEN);
  });
});

describe('backend read plays instead of an unnamed-visit question', () => {
  const now = new Date('2026-10-03T14:54:00.000Z');

  function cardWithRows() {
    return buildCallerMemoryCard({
      now,
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
      nextAppointment: {
        id: 'past-req',
        service_name: 'carpet cleaning',
        when_text: 'yesterday morning',
        status: 'requested',
        window_start: '2026-10-01T07:00:00.000Z',
        address_landmark: 'Rongai',
      },
      recentAppointments: [
        {
          id: 'upcoming',
          service_name: 'pet stain',
          when_text: 'tomorrow 10:00 AM',
          status: 'confirmed',
          window_start: '2026-10-04T07:00:00.000Z',
        },
        {
          id: 'done-visit',
          service_name: 'sofa cleaning',
          when_text: 'last Tuesday',
          status: 'done',
          address_landmark: 'Westlands',
        },
      ],
      openRequests: [
        {
          id: 'hold-open',
          request_type: 'hold',
          item: 'Atomic Habits',
          status: 'open',
          when_text: 'tomorrow',
          window_start: '2026-06-01T07:00:00.000Z',
          created_at: '2026-06-01T06:00:00.000Z',
        },
        {
          id: 'hold-done',
          request_type: 'hold',
          item: 'Old Book',
          status: 'fulfilled',
          when_text: 'last Tuesday',
        },
        {
          id: 'order-cancelled',
          request_type: 'order',
          item: 'diaries',
          status: 'cancelled',
          when_text: '3 March',
        },
      ],
    });
  }

  function script(card) {
    const profile = { vertical: 'home_services', callerMemory: card };
    let state = createBrainState(profile);
    return function say(text, lastAgentText) {
      state = observeCallerTurn(state, {
        text,
        profile,
        lastAgentText,
        detectedLanguage: 'en',
        resolvedLanguage: 'en',
      });
      return {
        state,
        local: resolveLocalReply({ text, state, profile, language: 'en' }),
      };
    };
  }

  it('reads every still-open row after Yes, not a question about unnamed visits', () => {
    const say = script(cardWithRows());
    say("How are you doing? Uh, I wanted to inquire about my booking.");
    say('No, I just want to inquire about the previous ones and the upcoming ones.');
    const yes = say('Yes', 'Am I speaking with Alvin?');
    assert.equal(yes.state.caller.nameConfirmed, true);
    const line = played(yes);
    assert.match(line, /You have carpet cleaning, past/i);
    assert.match(line, /Rongai/);
    assert.match(line, /You have pet stain, tomorrow 10:00 AM/i);
    assert.match(line, /You have a Atomic Habits request/i);
    assert.match(line, /sofa cleaning/i);
    assert.match(line, /Old Book/i);
    assert.match(line, /diaries/i);
    assert.doesNotMatch(line, /something specific/i);
    assert.doesNotMatch(line, /these visits/i);
    assert.doesNotMatch(line, /either of them/i);
    assert.doesNotMatch(line, /I don't have a booking for you/i);
    assert.doesNotMatch(line, /I don't have an order or a hold for you/i);
  });

  it('reads rows for read-them and which-ones-are-upcoming', () => {
    const say = script(cardWithRows());
    say("I wanted to inquire about my booking.");
    say('Yes', 'Am I speaking with Alvin?');
    const upcoming = say('which ones are upcoming?');
    assert.match(played(upcoming), /pet stain, tomorrow 10:00 AM/i);
    assert.match(played(upcoming), /carpet cleaning/i);
    assert.match(played(upcoming), /Atomic Habits/i);
    assert.doesNotMatch(played(upcoming), /specific detail/i);
    assert.doesNotMatch(played(upcoming), /these visits/i);
    const read = say('can you read them to me?');
    assert.match(played(read), /pet stain/i);
    assert.match(played(read), /carpet cleaning/i);
    assert.doesNotMatch(played(read), /anything else you'd like to do/i);
    assert.doesNotMatch(played(read), /either of them/i);
  });

  it('still returns the backend read on a later lookup after the name is confirmed', () => {
    const say = script(cardWithRows());
    say("I wanted to inquire about my booking.");
    const yes = say('Yes', 'Am I speaking with Alvin?');
    assert.equal(yes.state.caller.nameConfirmed, true);
    const later = say('What are my bookings?');
    assert.equal(later.state.caller.nameConfirmed, true);
    assert.match(played(later), /You have pet stain, tomorrow 10:00 AM/);
    assert.match(played(later), /You have carpet cleaning/);
    assert.match(played(later), /Atomic Habits/);
    assert.doesNotMatch(played(later), /something specific|these visits|either of them|anything else/i);
    const hold = say('What do I have on hold?');
    assert.match(played(hold), /Atomic Habits/);
    assert.doesNotMatch(played(hold), /I don't have an order or a hold for you/);
  });

  it('previous reads finished visits and fulfilled or cancelled holds', () => {
    const line = heard(cardWithRows(), 'And my previous ones?');
    assert.match(line, /sofa cleaning, last Tuesday, Westlands/i);
    assert.match(line, /Old Book/i);
    assert.match(line, /diaries request, 3 March/i);
    assert.doesNotMatch(line, /pet stain/i);
    assert.doesNotMatch(line, /I don't have a booking for you/i);
  });

  it('says exactly Nothing is still open when the confirmed file is empty', () => {
    const card = buildCallerMemoryCard({
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
    });
    const say = script(card);
    say("I wanted to inquire about my booking.");
    const yes = say('Yes', 'Am I speaking with Alvin?');
    assert.equal(played(yes), NOTHING_OPEN);
    assert.doesNotMatch(played(yes), /What would you like to do/);
    const again = say('can you read them to me?');
    assert.equal(played(again), NOTHING_OPEN);
  });
});

describe('windowless requested visits and compliments', () => {
  const now = new Date('2026-10-03T15:53:00.000Z');

  function dialCard() {
    return buildCallerMemoryCard({
      now,
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
      nextAppointment: {
        id: 'pet',
        service_name: 'Pet stain removal',
        status: 'requested',
        when_text: '17 Sep 10:00 AM',
        window_start: '2026-09-17T07:00:00.000Z',
        address_landmark: 'I saidI',
      },
      recentAppointments: [],
      openAppointments: [
        {
          id: 'pet',
          service_name: 'Pet stain removal',
          status: 'requested',
          when_text: '17 Sep 10:00 AM',
          window_start: '2026-09-17T07:00:00.000Z',
          address_landmark: 'I saidI',
        },
        { id: 'c1', service_name: 'Couch cleaning', status: 'requested', address_landmark: 'Kilimani' },
        { id: 'c2', service_name: 'Couch cleaning', status: 'requested', address_landmark: 'Kilimani' },
        { id: 'c3', service_name: 'Carpet cleaning', status: 'requested', address_landmark: 'Kilimani' },
        { id: 'c4', service_name: 'Carpet cleaning', status: 'requested', address_landmark: 'Westlands' },
        { id: 'c5', service_name: 'Carpet cleaning', status: 'requested', address_landmark: 'Westlands' },
        {
          id: 'c6',
          service_name: 'Carpet cleaning',
          status: 'requested',
          when_text: '22 Sep',
          address_landmark: 'Barnabas',
        },
      ],
      openRequests: [
        {
          id: 'r1',
          request_type: 'request',
          item: 'carpet and pet stain',
          status: 'open',
          when_text: '17 Sep 10:00 AM',
          window_start: '2026-09-17T07:00:00.000Z',
        },
        {
          id: 'r2',
          request_type: 'request',
          item: 'callback SMS confirmation',
          status: 'open',
          when_text: '17 Sep 10:00 AM',
          window_start: '2026-09-17T07:00:00.000Z',
        },
      ],
    });
  }

  it('reads every windowless requested visit, not only the dated visit and two requests', () => {
    const card = dialCard();
    assert.equal(card.openVisits.length, 7);
    const line = heard(card, 'What are my bookings?');
    assert.notEqual(line, NOTHING_OPEN);
    assert.match(line, /Pet stain removal/);
    assert.match(line, /carpet and pet stain/);
    assert.match(line, /callback SMS confirmation/);
    assert.equal((line.match(/You have Couch cleaning, Kilimani/g) || []).length, 2);
    assert.match(line, /You have Carpet cleaning, Kilimani/);
    assert.equal((line.match(/You have Carpet cleaning, Westlands/g) || []).length, 2);
    assert.match(line, /You have Carpet cleaning, 22 Sep, Barnabas/);
    const local = resolveLocalReply({
      text: 'What are my bookings?',
      state: boundState(card, 'home_services'),
      language: 'en',
    });
    assert.equal(local, null);
  });

  it('does not publish a file read or a name from a compliment while visits are still requested', () => {
    assert.equal(extractName("I'm Alvin"), 'Alvin');
    assert.equal(extractName("Actually, I'm impressed by your work"), null);
    assert.equal(extractName("I'm impressed by your work"), null);
    const card = dialCard();
    const bound = bindCallerMemoryCard(card, 'Alvin');
    const profile = { vertical: 'home_services', callerMemory: bound };
    let state = createBrainState(profile);
    state = observeCallerTurn(state, {
      text: "I wanted to inquire about my booking.",
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    state = observeCallerTurn(state, {
      text: 'Yes',
      profile,
      lastAgentText: 'Am I speaking with Alvin?',
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(state.caller.name, 'Alvin');
    assert.notEqual(state.conversation.fileReadSentence, NOTHING_OPEN);
    state = observeCallerTurn(state, {
      text: "Actually, I'm impressed by your work",
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    const local = resolveLocalReply({
      text: "Actually, I'm impressed by your work",
      state,
      profile,
      language: 'en',
    });
    assert.equal(local, null);
    assert.equal(state.conversation.fileReadSentence, '');
    assert.notEqual(state.conversation.fileReadSentence, NOTHING_OPEN);
    assert.equal(state.caller.name, 'Alvin');
    assert.notEqual(state.caller.name, 'impressed by your');
  });
});

describe('a when stays on the row that has it', () => {
  const now = new Date('2026-10-03T16:35:00.000Z');

  function dialCard() {
    return buildCallerMemoryCard({
      now,
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
      openAppointments: [
        {
          id: 'couch',
          service_name: 'Couch cleaning',
          status: 'requested',
          when_text: 'at 7:00 PM',
          address_landmark: 'Kilimani',
          notes: 'Couch cleaning',
          created_at: '2026-08-16T00:29:40.282Z',
        },
        {
          id: 'kilimani-carpet',
          service_name: 'Carpet cleaning',
          status: 'requested',
          when_text: 'Monday morning',
          address_landmark: 'Kilimani Nairobi',
          notes: 'Caller will not be available, someone else will be on site',
          created_at: '2026-08-16T00:52:24.100Z',
        },
        {
          id: 'westlands-bare',
          service_name: 'Carpet cleaning',
          status: 'requested',
          when_text: 'tomorrow at 12:00 PM',
          address_landmark: 'Westlands',
          notes: 'Carpet cleaning booking',
          created_at: '2026-08-16T01:39:18.731Z',
        },
        {
          id: 'westlands-noted',
          service_name: 'Carpet cleaning',
          status: 'requested',
          when_text: 'tomorrow at 12:00 PM',
          address_landmark: 'Westlands, Nairobi',
          notes: 'visit — Carpet cleaning — tomorrow at 12:00 PM — Westlands, Nairobi',
          created_at: '2026-08-16T01:39:28.589Z',
        },
        {
          id: 'barnabas',
          service_name: 'Carpet cleaning',
          status: 'requested',
          when_text: '22 Sep 2026 09:00',
          window_start: '2026-09-22T06:00:00.000Z',
          address_landmark: 'Barnabas',
          notes: 'Carpet cleaning booking request',
          created_at: '2026-09-04T03:02:24.156Z',
        },
      ],
    });
  }

  it('does not give a windowless row a sibling when, and says the Barnabas date once', () => {
    const card = dialCard();
    const lines = card.openVisits.join(' || ');
    assert.match(lines, /Couch cleaning \| requested \| Kilimani/);
    assert.doesNotMatch(lines, /7:00/);
    assert.doesNotMatch(lines, /16 Aug/);
    assert.match(lines, /Kilimani Nairobi/);
    assert.doesNotMatch(lines, /Monday morning/);
    assert.doesNotMatch(lines, /17 Aug Monday/);
    assert.doesNotMatch(
      card.openVisits.find((line) => /\| Westlands$/.test(line)) || '',
      /12:00/
    );
    assert.match(lines, /Westlands, Nairobi/);
    assert.match(lines, /12:00 PM/);
    assert.equal((lines.match(/12:00 PM/g) || []).length, 1);
    assert.match(lines, /past 22 Sep 2026 09:00/);
    assert.equal((lines.match(/22 Sep/g) || []).length, 1);
    assert.doesNotMatch(lines, /22 Sep 22 Sep/);
    const sentence = heard(card, 'What are my bookings?');
    assert.notEqual(sentence, NOTHING_OPEN);
    assert.match(sentence, /You have Couch cleaning, Kilimani/);
    assert.doesNotMatch(sentence, /7:00|16 Aug|Monday morning/);
    assert.match(sentence, /12:00 PM/);
    assert.equal((sentence.match(/12:00 PM/g) || []).length, 1);
    assert.match(sentence, /past 22 Sep 2026 09:00/);
    assert.doesNotMatch(sentence, /22 Sep 22 Sep/);
    assert.equal(
      resolveLocalReply({
        text: 'What are my bookings?',
        state: boundState(card, 'home_services'),
        language: 'en',
      }),
      null
    );
  });

  it('does not tell the model the file is empty when requested rows exist', () => {
    const card = dialCard();
    const profile = { vertical: 'home_services', callerMemory: card };
    let state = createBrainState(profile);
    state = observeCallerTurn(state, {
      text: 'I wanted to inquire about my booking.',
      profile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    assert.equal(state.caller.nameConfirmed, false);
    const decision = determineNextBestAction({
      state,
      capabilities: { createAppointment: true },
    });
    assert.doesNotMatch(decision.reason, /Nothing saved for this speaker/);
    assert.doesNotMatch(decision.reason, /do not have a booking/i);
    assert.doesNotMatch(decision.reason, /do not have their bookings/i);
    const empty = buildCallerMemoryCard({
      contact: { phone: '+254790381872', name: 'Alvin', metadata: {} },
    });
    const emptyProfile = { vertical: 'home_services', callerMemory: empty };
    let emptyState = createBrainState(emptyProfile);
    emptyState = observeCallerTurn(emptyState, {
      text: 'I wanted to inquire about my booking.',
      profile: emptyProfile,
      detectedLanguage: 'en',
      resolvedLanguage: 'en',
    });
    const emptyDecision = determineNextBestAction({ state: emptyState });
    assert.match(emptyDecision.reason, /Nothing saved for this speaker/);
  });
});
