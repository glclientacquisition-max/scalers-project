const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildCallerMemoryCard,
  bindCallerMemoryCard,
  formatReturningCallerForPrompt,
} = require('../src/conversation/callerMemory');
const { createBrainState } = require('../src/conversation/brainState');
const { determineNextBestAction } = require('../src/conversation/nextBestAction');
const { resolveLocalReply } = require('../src/conversation/turnPolicy');
const { hasReadableFile } = require('../src/conversation/fileRead');
const { looksLikePastBookingTalk } = require('../src/conversation/visitTalk');

const BOOKING_DENIAL = "I don't have a booking for you.";
const HOLD_DENIAL = "I don't have an order or a hold for you.";
const NOTHING_OPEN = 'Nothing is still open.';

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
    const local = resolveLocalReply({
      text: "I'm inquiring about my bookings",
      state,
      language: 'en',
    });
    assert.equal(local, null);
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
    const local = resolveLocalReply({
      text: 'And my previous ones?',
      state,
      language: 'en',
    });
    assert.equal(local, null);
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
    assert.notEqual(local && local.line, BOOKING_DENIAL);
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
    const local = resolveLocalReply({
      text: 'What do I have on hold?',
      state,
      language: 'en',
    });
    assert.equal(local, null);
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
      const local = resolveLocalReply({ text, state, language: 'en' });
      assert.equal(local, null);
      assert.notEqual(local && local.line, HOLD_DENIAL);
      assert.notEqual(local && local.line, BOOKING_DENIAL);
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
    const home = boundState(card, 'home_services');
    const visit = resolveLocalReply({
      text: "I'm inquiring about my bookings",
      state: home,
      language: 'en',
    });
    assert.equal(visit.line, NOTHING_OPEN);
    assert.notEqual(visit.line, BOOKING_DENIAL);
    const again = resolveLocalReply({ text: 'Really?', state: home, language: 'en' });
    assert.equal(again.line, NOTHING_OPEN);
    assert.notEqual(again.line, BOOKING_DENIAL);
    const retail = boundState(card, 'retail');
    const hold = resolveLocalReply({
      text: 'What do I have on hold?',
      state: retail,
      language: 'en',
    });
    assert.equal(hold.line, NOTHING_OPEN);
    assert.notEqual(hold.line, HOLD_DENIAL);
  });
});
