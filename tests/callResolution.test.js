const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveCallResolution,
  parseResolution,
  VISIT_REQUESTED_NOTE,
  HOLD_OPEN_NOTE,
} = require('../src/conversation/callResolution');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

describe('deriveCallResolution', () => {
  it('marks succeeded holds as resolved', () => {
    let state = createBrainState();
    state.intent = 'hold_or_pickup';
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
        fingerprint: 'x',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.primaryIntent, 'hold_or_pickup');
    assert.equal(out.resolutionNote, HOLD_OPEN_NOTE);
    assert.doesNotMatch(out.resolutionNote || '', /fulfilled|ready|booked/i);
  });

  it('does not claim a closed visit while status is requested', () => {
    let state = createBrainState();
    state.intent = 'book_visit';
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'succeeded',
        appointmentStatus: 'requested',
        fingerprint: 'v-req',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.primaryIntent, 'book_visit');
    assert.equal(out.resolutionNote, VISIT_REQUESTED_NOTE);
    assert.doesNotMatch(out.resolutionNote || '', /booked|confirmed|scheduled/i);
  });

  it('allows confirmed language only after the visit is confirmed', () => {
    const out = deriveCallResolution({
      brainState: createBrainState(),
      toolResults: [
        {
          action: 'update_appointment',
          status: 'succeeded',
          appointmentStatus: 'confirmed',
        },
      ],
    });
    assert.equal(out.resolutionNote, 'Visit confirmed');
  });

  it('keeps appointment status through Brain persist so hangup notes stay honest', () => {
    const state = recordActionResults(createBrainState(), [
      {
        action: 'update_appointment',
        status: 'succeeded',
        appointmentStatus: 'confirmed',
        value: { serviceName: 'Carpet cleaning', whenText: 'Tuesday 10 AM' },
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolutionNote, 'Visit confirmed');
    assert.doesNotMatch(out.resolutionNote || '', /Visit request saved/);
  });

  it('maps runtime hold intent onto hold_or_pickup', () => {
    let state = createBrainState();
    state.intent = 'hold';
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
        fingerprint: 'y',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.primaryIntent, 'hold_or_pickup');
  });

  it('marks answered direct intents as resolved', () => {
    const state = createBrainState();
    state.intent = 'hours';
    state.conversation.turnCount = 2;
    state.goal.missingSlots = [];
    state.resolution.nextBestAction = 'ANSWER';
    state.resolution.status = 'unresolved';
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.primaryIntent, 'hours_open');
  });

  it('marks escalation as needs_human', () => {
    const out = deriveCallResolution({
      brainState: createBrainState(),
      toolResults: [{ action: 'escalate', status: 'succeeded' }],
    });
    assert.equal(out.resolution, 'needs_human');
  });

  it('marks very short calls as abandoned', () => {
    const out = deriveCallResolution({
      brainState: createBrainState(),
      turnCount: 1,
    });
    assert.equal(out.resolution, 'abandoned');
  });

  it('parseResolution accepts known values only', () => {
    assert.equal(parseResolution('resolved'), 'resolved');
    assert.equal(parseResolution('nope'), null);
  });

  it('locks persist intent at a saved visit even if the last turn was hours', () => {
    let state = createBrainState();
    state.intent = 'hours';
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'succeeded',
        fingerprint: 'v1',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.primaryIntent, 'book_visit');
  });

  it('locks persist intent at a saved hold even if the last turn was hours', () => {
    let state = createBrainState();
    state.intent = 'hours';
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
        fingerprint: 'h1',
      },
    ]);
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.primaryIntent, 'hold_or_pickup');
  });

  it('locks persist intent at human when escalate saved after a FAQ', () => {
    const out = deriveCallResolution({
      brainState: { ...createBrainState(), intent: 'hours' },
      toolResults: [{ action: 'escalate', status: 'succeeded' }],
    });
    assert.equal(out.resolution, 'needs_human');
    assert.equal(out.primaryIntent, 'human');
  });

  it('keeps the exact requested-visit note after a later END turn wipes lastResults', () => {
    let state = createBrainState();
    state.intent = 'book_visit';
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'succeeded',
        appointmentStatus: 'requested',
        fingerprint: 'v-keep',
      },
    ]);
    state = recordActionResults(state, [
      {
        action: 'save_caller_info',
        status: 'succeeded',
        name: 'Amina',
      },
    ]);
    state.resolution.nextBestAction = 'END';
    state.resolution.reason = 'The response included a permitted end-call action.';
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.resolution, 'resolved');
    assert.equal(out.resolutionNote, VISIT_REQUESTED_NOTE);
    assert.doesNotMatch(out.resolutionNote || '', /permitted end-call|Answered/i);
  });

  it('keeps last-turn intent when no work row was saved', () => {
    const state = createBrainState();
    state.intent = 'booking';
    state.conversation.turnCount = 3;
    state.goal.missingSlots = ['landmark'];
    const out = deriveCallResolution({ brainState: state });
    assert.equal(out.primaryIntent, 'book_visit');
    assert.notEqual(out.resolution, 'resolved');
  });
});
