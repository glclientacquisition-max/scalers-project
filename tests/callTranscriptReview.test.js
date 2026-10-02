const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractCallerNameFromTranscript,
  formatTranscriptForReview,
  isReviewEnabled,
  mergeTranscriptReview,
  parseExtractedCallerName,
  parseReviewJson,
  persistCompletedCallContact,
  resetTranscriptReviewScheduleForTests,
  runPostCallHangupJobs,
  runPostCallTranscriptReview,
  schedulePostCallTranscriptReview,
  toolFlagsFromBrain,
} = require('../src/conversation/callTranscriptReview');
const { createBrainState, recordActionResults } = require('../src/conversation/brainState');

afterEach(() => {
  resetTranscriptReviewScheduleForTests();
  delete process.env.POST_CALL_GEMINI_REVIEW;
});

const holdFlags = {
  holdSaved: true,
  visitSaved: false,
  escalateSaved: false,
  handoff: false,
};

const visitFlags = {
  holdSaved: false,
  visitSaved: true,
  escalateSaved: false,
  handoff: false,
};

const escalateFlags = {
  holdSaved: false,
  visitSaved: false,
  escalateSaved: true,
  handoff: true,
};

const emptyFlags = {
  holdSaved: false,
  visitSaved: false,
  escalateSaved: false,
  handoff: false,
};

describe('formatTranscriptForReview', () => {
  it('labels caller and receptionist turns', () => {
    const text = formatTranscriptForReview([
      { speaker: 'caller', text: 'Are you open on Sunday?' },
      { speaker: 'agent', text_content: 'Yes, 10 to 4.' },
      { speaker: 'system', text: 'noise' },
    ]);
    assert.match(text, /^Caller: Are you open on Sunday\?/m);
    assert.match(text, /^Receptionist: Yes, 10 to 4\./m);
    assert.doesNotMatch(text, /noise/);
  });
});

describe('parseReviewJson', () => {
  it('parses fenced JSON and strips dash punctuation from reason', () => {
    const parsed = parseReviewJson(`
\`\`\`json
{
  "reason": "Brian left a hold — Atomic Habits tomorrow at 5",
  "primary_intent": "hold_or_pickup",
  "needs_human": false,
  "needs_owner": false,
  "urgent": false,
  "confidence": 0.91
}
\`\`\`
`);
    assert.equal(parsed.primary_intent, 'hold_or_pickup');
    assert.equal(parsed.needs_human, false);
    assert.doesNotMatch(parsed.reason, /[\u2014\u2013]/);
    assert.match(parsed.reason, /Atomic Habits/);
    const exact = parseReviewJson(
      JSON.stringify({
        reason: 'Visit request saved — confirm on desk.',
        done: 'Visit request saved — confirm on desk.',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.9,
      })
    );
    assert.equal(exact.reason, 'Visit request saved — confirm on desk.');
    assert.equal(exact.done, 'Visit request saved — confirm on desk.');
    assert.equal(parsed.want, parsed.reason);
    assert.equal(parsed.done, 'None.');
    assert.equal(parsed.next, 'None.');
    assert.equal(parsed.mood, 'unknown');
    assert.equal(parsed.confidence, 0.91);
  });

  it('parses want, done, mood, and next', () => {
    const parsed = parseReviewJson(
      JSON.stringify({
        want: 'Colin booked a mattress cleaning visit for tomorrow at 10 AM at Degrees Apartments.',
        done: 'Visit saved.',
        mood: 'calm',
        next: 'Confirm the visit.',
        reason: 'Colin booked a visit tomorrow.',
        primary_intent: 'book_visit',
        needs_human: false,
        needs_owner: false,
        urgent: false,
        confidence: 0.94,
      })
    );
    assert.match(parsed.want, /mattress cleaning visit/);
    assert.equal(parsed.done, 'Visit saved.');
    assert.equal(parsed.mood, 'calm');
    assert.equal(parsed.next, 'Confirm the visit.');
    assert.match(parsed.reason, /booked a visit tomorrow/);
  });

  it('maps callback aliases onto human intent', () => {
    const parsed = parseReviewJson(
      JSON.stringify({
        reason: 'Caller asked to speak to the owner now',
        primary_intent: 'needs_human',
        needs_human: true,
        confidence: 0.8,
      })
    );
    assert.equal(parsed.primary_intent, 'human');
    assert.equal(parsed.needs_human, true);
  });
});

describe('mergeTranscriptReview', () => {
  it('applies a clean owner sentence', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Brian left a hold.' },
      toolFlags: holdFlags,
      review: {
        reason: 'Brian left a hold for Atomic Habits. Pickup tomorrow at 5pm.',
        primary_intent: 'hold_or_pickup',
        needs_human: false,
        needs_owner: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.applied.reason, true);
    assert.match(merged.reason, /Atomic Habits/);
    assert.match(merged.want, /Atomic Habits/);
    assert.equal(merged.resolution, 'resolved');
    assert.equal(merged.primaryIntent, 'hold_or_pickup');
  });

  it('never downgrades a successful escalate', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'human', resolution: 'needs_human' },
      summary: { reason: 'Amina needs you to return the call.' },
      toolFlags: escalateFlags,
      review: {
        reason: 'Hours question was answered.',
        primary_intent: 'hours_open',
        needs_human: false,
        needs_owner: false,
        confidence: 0.99,
      },
    });
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.applied.intent, false);
    assert.equal(merged.applied.resolution, false);
    assert.match(merged.reason, /Amina needs you/);
  });

  it('never overrides a saved hold with needs_human', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Brian left a hold.' },
      toolFlags: holdFlags,
      review: {
        reason: 'Brian still needs a callback about the hold.',
        primary_intent: 'human',
        needs_human: true,
        needs_owner: false,
        confidence: 0.99,
      },
    });
    assert.equal(merged.primaryIntent, 'hold_or_pickup');
    assert.equal(merged.resolution, 'resolved');
  });

  it('downgrades false cleaning escalate when a visit was saved', () => {
    const merged = mergeTranscriptReview({
      vertical: 'home_services',
      derived: { primaryIntent: 'human', resolution: 'needs_human' },
      summary: {
        reason: 'Urgent emergency air bnb cleanup needed now in Westlands',
      },
      toolFlags: {
        ...visitFlags,
        escalateSaved: true,
        escalateReason:
          'Urgent emergency air bnb cleanup needed now in Westlands',
      },
      review: {
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.primaryIntent, 'book_visit');
    assert.notEqual(merged.resolution, 'needs_human');
  });

  it('never overrides a saved visit with needs_human', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit request saved — confirm on desk.' },
      toolFlags: visitFlags,
      review: {
        reason: 'Mary needs you to confirm the plumber.',
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.primaryIntent, 'book_visit');
    assert.equal(merged.resolution, 'resolved');
  });

  it('does not ask the owner to confirm a visit updated on another call', () => {
    const state = recordActionResults(createBrainState(), [
      {
        action: 'update_appointment',
        status: 'succeeded',
        appointmentStatus: 'requested',
        record: { status: 'requested', call_id: 'call-original', service_name: 'Carpet cleaning' },
      },
    ]);
    const flags = toolFlagsFromBrain(state, 'call-later');
    assert.equal(flags.visitSaved, false);
    assert.equal(flags.updatedElsewhere, true);
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Caller moved the visit.' },
      toolFlags: flags,
      review: {
        want: 'Visit not booked.',
        done: 'Visit request saved — confirm on desk.',
        next: 'Confirm the visit.',
        mood: 'neutral',
        reason: 'Visit not booked.',
        confidence: 0.9,
      },
    });
    assert.equal(merged.done, 'None.');
    assert.equal(merged.next, 'None.');
    assert.equal(merged.resolution, 'resolved');
    assert.doesNotMatch(`${merged.done} ${merged.next} ${merged.reason}`, /Visit not booked|confirm on desk/i);
  });

  it('asks them back when the visit update failed', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'cancel', resolution: 'needs_human' },
      summary: { reason: 'Caller wanted to move the visit.' },
      toolFlags: {
        holdSaved: false,
        visitSaved: false,
        callbackSaved: false,
        updateFailed: true,
        callerName: 'Amina',
        service: 'carpet cleaning',
        place: 'Runda',
        when: '',
        intent: 'cancellation',
      },
      review: {
        want: 'Move the visit.',
        done: 'None.',
        next: 'None.',
        mood: 'neutral',
        reason: 'Move the visit.',
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'Call them back.');
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.primaryIntent, 'human');
  });

  it('does not say a visit was saved when no row succeeded', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'unresolved' },
      summary: { reason: 'Caller asked for carpet cleaning.' },
      toolFlags: {
        holdSaved: false,
        visitSaved: false,
        callbackSaved: false,
        visitRequested: false,
        refusedWhen: ['tomorrow 7:00 AM'],
      },
      review: {
        reason: 'Visit request saved — confirm on desk.',
        want: 'Alvin wants a visit for carpet cleaning at The Grace Apartments in Rongai tomorrow at 7:00 AM.',
        done: 'Visit request saved — confirm on desk.',
        next: 'Confirm the visit.',
        primary_intent: 'book_visit',
        needs_human: true,
        confidence: 0.8,
      },
    });
    assert.equal(merged.done, 'None.');
    assert.equal(merged.reason, 'Caller asked for carpet cleaning.');
    assert.doesNotMatch(merged.want, /7:00 AM/i);
    assert.doesNotMatch(merged.reason, /visit request saved/i);
  });

  it('states the last place and time for a talked visit with nothing saved', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'unresolved' },
      summary: { reason: 'Caller asked for carpet cleaning.' },
      toolFlags: {
        holdSaved: false,
        visitSaved: false,
        callbackSaved: false,
        visitRequested: false,
        visitAsk: true,
        service: 'carpet cleaning',
        place: 'Runda',
        when: 'morning',
        callerName: '',
        refusedWhen: ['7:00 AM'],
        refusedPlaces: ['Rongai'],
      },
      review: {
        reason: 'Callback was noted for carpet cleaning in Rongai at 7:00 AM.',
        want: 'They want carpet cleaning in Rongai at 7:00 AM. Callback was noted.',
        done: 'Callback was noted.',
        next: 'Callback noted.',
        mood: 'calm',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.4,
      },
    });
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.want, 'Carpet cleaning in Runda in the morning. No name.');
    assert.equal(merged.done, 'None.');
    assert.equal(merged.next, 'Call them back.');
    assert.doesNotMatch(merged.want, /7:00|Rongai|callback was noted/i);
    assert.doesNotMatch(merged.reason, /callback was noted/i);
    assert.doesNotMatch(merged.done, /callback/i);
  });

  it('keeps a callback sentence only when a callback row exists', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'callback', resolution: 'resolved' },
      summary: { reason: 'Callback was noted.' },
      toolFlags: {
        holdSaved: true,
        callbackSaved: true,
        visitSaved: false,
      },
      review: {
        reason: 'Callback was noted for a quote.',
        want: 'Callback was noted for a quote.',
        done: 'Callback was noted.',
        next: 'Call them back.',
        primary_intent: 'human',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.match(merged.want, /callback was noted/i);
    assert.match(merged.done, /callback was noted/i);
  });

  it('sets Confirm the visit while the visit is still requested', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit request saved — confirm on desk.' },
      toolFlags: { ...visitFlags, visitRequested: true },
      review: {
        reason: 'Mary wants a mattress cleaning visit tomorrow.',
        want: 'Mary wants a mattress cleaning visit tomorrow.',
        done: 'Visit booked.',
        next: 'Call them back.',
        mood: 'calm',
        primary_intent: 'book_visit',
        needs_human: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.next, 'Confirm the visit.');
    assert.equal(merged.done, 'Visit request saved — confirm on desk.');
    assert.equal(merged.mood, 'calm');
    assert.match(merged.want, /mattress cleaning/);
  });

  it('does not confirm a reschedule that is already confirmed', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit confirmed' },
      toolFlags: { ...visitFlags, visitRequested: false },
      review: {
        reason: 'Mary moved the carpet cleaning visit to Friday at 2 PM.',
        want: 'Mary moved the carpet cleaning visit to Friday at 2 PM.',
        done: 'Visit confirmed.',
        next: 'Confirm the visit.',
        mood: 'calm',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'None.');
    assert.equal(merged.done, 'Visit confirmed.');
    assert.match(merged.want, /Friday at 2 PM/);
  });

  it('does not call back after a cancelled visit', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'cancel', resolution: 'resolved' },
      summary: { reason: 'Visit updated (cancelled)' },
      toolFlags: { ...visitFlags, visitRequested: false },
      review: {
        reason: 'Mary cancelled the carpet cleaning visit.',
        want: 'Mary cancelled the carpet cleaning visit.',
        done: 'Visit updated (cancelled).',
        next: 'Call them back.',
        mood: 'calm',
        primary_intent: 'cancel',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'None.');
    assert.match(merged.done, /cancelled/i);
    assert.notEqual(merged.next, 'Confirm the visit.');
  });

  it('sets the open hold done line and clears a false callback', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Brian left a hold.' },
      toolFlags: { ...holdFlags, holdOpen: true, callbackSaved: false },
      review: {
        reason: 'Brian left a hold for Atomic Habits. Pickup tomorrow at 5pm.',
        want: 'Brian wants Atomic Habits held for pickup tomorrow at 5pm.',
        done: 'The book is ready.',
        next: 'Call them back.',
        mood: 'calm',
        primary_intent: 'hold_or_pickup',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.done, 'Hold saved; awaiting owner Done.');
    assert.equal(merged.next, 'None.');
    assert.match(merged.want, /Atomic Habits/);
  });

  it('keeps Call them back for a saved callback', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'callback', resolution: 'resolved' },
      summary: { reason: 'Callback was noted.' },
      toolFlags: {
        holdSaved: true,
        holdOpen: true,
        callbackSaved: true,
        visitSaved: false,
        visitRequested: false,
      },
      review: {
        reason: 'Callback was noted for a quote.',
        want: 'Callback was noted for a quote.',
        done: 'Callback was noted.',
        next: 'None.',
        primary_intent: 'human',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'Call them back.');
    assert.match(merged.done, /callback was noted/i);
    assert.notEqual(merged.done, 'Hold saved; awaiting owner Done.');
  });

  it('does not reopen a hold that is already done', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hold_or_pickup', resolution: 'resolved' },
      summary: { reason: 'Hold done' },
      toolFlags: {
        holdSaved: true,
        holdOpen: false,
        callbackSaved: false,
        visitSaved: false,
        visitRequested: false,
      },
      review: {
        reason: 'Brian collected Atomic Habits.',
        want: 'Brian collected Atomic Habits.',
        done: 'Hold done.',
        next: 'Call them back.',
        primary_intent: 'hold_or_pickup',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'None.');
    assert.equal(merged.done, 'Hold done.');
  });

  it('strips a refused hour from Want after a visit row is saved', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit request saved — confirm on desk.' },
      toolFlags: {
        ...visitFlags,
        visitRequested: true,
        refusedWhen: ['7:00 AM'],
        refusedPlaces: ['Rongai'],
      },
      review: {
        reason: 'Mary wants carpet cleaning in Rongai tomorrow at 7:00 AM.',
        want: 'Mary wants carpet cleaning in Rongai tomorrow at 7:00 AM and at 10:00 AM in Kilimani.',
        done: 'Visit request saved — confirm on desk.',
        next: 'Call them back.',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.next, 'Confirm the visit.');
    assert.doesNotMatch(merged.want, /7:00 AM/i);
    assert.doesNotMatch(merged.want, /Rongai/i);
    assert.match(merged.want, /10:00 AM/);
    assert.match(merged.want, /Kilimani/);
    assert.doesNotMatch(merged.reason, /7:00 AM/i);
  });

  it('keeps a return line when a person was asked and nothing was saved', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'human', resolution: 'needs_human' },
      summary: { reason: 'Amina asked for the owner.' },
      toolFlags: escalateFlags,
      review: {
        reason: 'Amina asked to speak to the owner about a leak.',
        want: 'Amina asked to speak to the owner about a leak.',
        done: 'Escalation sent.',
        next: 'Call them back.',
        mood: 'urgent',
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.92,
      },
    });
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.next, 'Call them back.');
    assert.equal(merged.done, 'Escalation sent.');
  });

  it('does not ask for a callback after a finished answer', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'hours_open', resolution: 'resolved' },
      summary: { reason: 'Caller asked about hours.' },
      toolFlags: {
        ...emptyFlags,
        finishedAnswer: true,
      },
      review: {
        reason: 'Caller asked if the shop is open on Sunday. Receptionist said 10 to 4.',
        want: 'Sunday hours.',
        done: 'Hours answered.',
        next: 'Call them back.',
        primary_intent: 'hours_open',
        needs_human: false,
        needs_owner: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.resolution, 'resolved');
    assert.equal(merged.next, 'None.');
    assert.equal(merged.done, 'Hours answered.');
  });

  it('rewrites booked hangup copy while the visit is still requested', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit request saved — confirm on desk.' },
      toolFlags: { ...visitFlags, visitRequested: true },
      review: {
        reason: 'Mary booked a visit tomorrow.',
        want: 'Mary booked a mattress cleaning visit.',
        done: 'Visit request saved.',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.94,
      },
    });
    assert.equal(merged.reason, 'Visit request saved — confirm on desk.');
    assert.equal(merged.done, 'Visit request saved — confirm on desk.');
    assert.doesNotMatch(merged.reason, /booked a visit|book that for you/i);
    assert.doesNotMatch(merged.want, /booked/i);
  });

  it('completes truncated Visit request saved hangup copy', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
      summary: { reason: 'Visit request saved.' },
      toolFlags: { ...visitFlags, visitRequested: true },
      review: {
        reason: 'Visit request saved.',
        want: 'Mary wants mattress cleaning tomorrow.',
        done: 'Visit request saved',
        primary_intent: 'book_visit',
        needs_human: false,
        confidence: 0.9,
      },
    });
    assert.equal(merged.reason, 'Visit request saved — confirm on desk.');
    assert.equal(merged.done, 'Visit request saved — confirm on desk.');
    assert.match(merged.want, /mattress cleaning/);
    assert.doesNotMatch(merged.want, /booked/i);
  });

  it('upgrades to needs_human at high confidence when nothing was saved', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'general_enquiry', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'James asked to speak to the owner about an unpaid invoice.',
        primary_intent: 'human',
        needs_human: true,
        needs_owner: false,
        confidence: 0.8,
      },
    });
    assert.equal(merged.primaryIntent, 'human');
    assert.equal(merged.resolution, 'needs_human');
    assert.equal(merged.applied.intent, true);
    assert.equal(merged.applied.resolution, true);
  });

  it('does not upgrade to needs_human below confidence', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'general_enquiry', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Maybe they wanted a person.',
        primary_intent: 'human',
        needs_human: true,
        confidence: 0.5,
      },
    });
    assert.equal(merged.primaryIntent, 'general_enquiry');
    assert.equal(merged.resolution, 'unresolved');
  });

  it('marks a confident FAQ as resolved without a return call', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'other', resolution: 'unresolved' },
      summary: { reason: 'Caller called.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Caller asked if the shop is open on Sunday. Receptionist said 10 to 4.',
        primary_intent: 'hours_open',
        needs_human: false,
        needs_owner: false,
        confidence: 0.88,
      },
    });
    assert.equal(merged.resolution, 'resolved');
    assert.equal(merged.primaryIntent, 'hours_open');
    assert.equal(merged.applied.resolution, true);
  });

  it('does not mark resolved when the owner still owes a fact', () => {
    const merged = mergeTranscriptReview({
      derived: { primaryIntent: 'price', resolution: 'unresolved' },
      summary: { reason: 'Caller asked about price.' },
      toolFlags: emptyFlags,
      review: {
        reason: 'Caller asked the price of Atomic Habits. Receptionist said someone will check.',
        primary_intent: 'product_inquiry',
        needs_human: false,
        needs_owner: true,
        confidence: 0.95,
      },
    });
    assert.equal(merged.resolution, 'unresolved');
    assert.equal(merged.applied.resolution, false);
  });
});

describe('toolFlagsFromBrain', () => {
  it('reads succeeded tools and handoff', () => {
    let state = createBrainState();
    state.handoff.requested = true;
    state = recordActionResults(state, [
      {
        action: 'create_service_request',
        status: 'succeeded',
        requestType: 'hold',
      },
    ]);
    const flags = toolFlagsFromBrain(state);
    assert.equal(flags.holdSaved, true);
    assert.equal(flags.visitSaved, false);
    assert.equal(flags.handoff, true);
  });

  it('keeps the last wanted place and drops a refused hour and place', () => {
    let state = createBrainState({ vertical: 'home_services' });
    state.intent = 'booking';
    state.entities.service = {
      value: 'carpet cleaning',
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: false,
    };
    state.entities.location = {
      value: 'Runda',
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: false,
    };
    state.entities.when = {
      value: 'morning',
      source: 'caller_explicit',
      confidence: 0.9,
      confirmed: false,
    };
    state.visitPlace = { blocked: '' };
    state = recordActionResults(state, [
      {
        action: 'create_appointment',
        status: 'invalid',
        code: 'outside_coverage',
        value: { landmark: 'Rongai', serviceName: 'carpet cleaning' },
      },
      {
        action: 'create_appointment',
        status: 'invalid',
        code: 'outside_hours',
        value: { whenText: '7:00 AM', serviceName: 'carpet cleaning' },
      },
    ]);
    const flags = toolFlagsFromBrain(state);
    assert.equal(flags.place, 'Runda');
    assert.equal(flags.when, 'morning');
    assert.equal(flags.service, 'carpet cleaning');
    assert.equal(flags.callerName, '');
    assert.equal(flags.visitSaved, false);
    assert.ok(flags.refusedWhen.some((row) => /7:00 AM/i.test(row)));
    assert.ok(flags.refusedPlaces.some((row) => /Rongai/i.test(row)));
  });

  it('keeps a reschedule on the existing visit status', () => {
    const requested = toolFlagsFromBrain(
      recordActionResults(createBrainState(), [
        {
          action: 'update_appointment',
          status: 'succeeded',
          appointmentStatus: 'requested',
        },
      ])
    );
    assert.equal(requested.visitSaved, true);
    assert.equal(requested.visitRequested, true);

    const confirmed = toolFlagsFromBrain(
      recordActionResults(createBrainState(), [
        {
          action: 'update_appointment',
          status: 'succeeded',
          appointmentStatus: 'confirmed',
        },
      ])
    );
    assert.equal(confirmed.visitSaved, true);
    assert.equal(confirmed.visitRequested, false);

    const cancelled = toolFlagsFromBrain(
      recordActionResults(createBrainState(), [
        {
          action: 'update_appointment',
          status: 'succeeded',
          appointmentStatus: 'cancelled',
        },
      ])
    );
    assert.equal(cancelled.visitSaved, true);
    assert.equal(cancelled.visitRequested, false);
  });

  it('keeps visitRequested after a later non-visit tool turn', () => {
    let state = recordActionResults(createBrainState(), [
      {
        action: 'create_appointment',
        status: 'succeeded',
        appointmentStatus: 'requested',
        fingerprint: 'v-keep',
      },
    ]);
    state = recordActionResults(state, [
      { action: 'save_caller_info', status: 'succeeded', name: 'Amina' },
    ]);
    const flags = toolFlagsFromBrain(state);
    assert.equal(flags.visitSaved, true);
    assert.equal(flags.visitRequested, true);
  });
});

describe('runPostCallTranscriptReview', () => {
  it('loads turns, merges, and saves without calling live Gemini', async () => {
    const saved = [];
    const result = await runPostCallTranscriptReview(
      {
        callSid: 'CA_review_1',
        derived: { primaryIntent: 'hours_open', resolution: 'resolved' },
        summary: { reason: 'Caller asked about hours.' },
        toolFlags: emptyFlags,
      },
      {
        waitMs: 0,
        retryMs: 0,
        delay: async () => {},
        loadTurns: async () => [
          { speaker: 'caller', text: 'Are you open on Sunday?' },
          { speaker: 'agent', text: 'Yes, from 10 to 4.' },
        ],
        generateText: async ({ user }) => {
          assert.match(user, /Are you open on Sunday/);
          return JSON.stringify({
            reason: 'Caller asked if the shop is open Sunday. Receptionist said 10 to 4.',
            primary_intent: 'hours_open',
            needs_human: false,
            needs_owner: false,
            urgent: false,
            confidence: 0.92,
          });
        },
        save: async (payload) => {
          saved.push(payload);
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(saved.length, 1);
    assert.match(saved[0].merged.reason, /Sunday/);
    assert.match(saved[0].merged.want, /Sunday/);
    assert.equal(saved[0].merged.done, 'None.');
    assert.equal(saved[0].merged.next, 'None.');
    assert.equal(saved[0].merged.resolution, 'resolved');
  });

  it('writes No conversation for silence with no transcript', async () => {
    const saved = [];
    const result = await runPostCallTranscriptReview(
      { callSid: 'CA_silence', callStatus: 'no_answer' },
      {
        waitMs: 0,
        retryMs: 0,
        delay: async () => {},
        loadTurns: async () => [],
        generateText: async () => {
          throw new Error('should not generate');
        },
        save: async (payload) => {
          saved.push(payload);
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.silence, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].merged.want, 'No conversation.');
    assert.equal(saved[0].merged.done, 'None.');
    assert.equal(saved[0].merged.mood, 'unknown');
    assert.equal(saved[0].merged.next, 'None.');
    assert.equal(saved[0].merged.applied.resolution, false);
  });

  it('no-ops without turns', async () => {
    const result = await runPostCallTranscriptReview(
      { callSid: 'CA_empty' },
      {
        waitMs: 0,
        retryMs: 0,
        delay: async () => {},
        loadTurns: async () => [],
        generateText: async () => {
          throw new Error('should not generate');
        },
        save: async () => {
          throw new Error('should not save');
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_turns');
  });

  it('honors POST_CALL_GEMINI_REVIEW=off for the review pass only', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    assert.equal(isReviewEnabled(), false);
    const result = await runPostCallTranscriptReview({ callSid: 'CA_off' });
    assert.equal(result.reason, 'disabled');
    const scheduled = schedulePostCallTranscriptReview(
      { callSid: 'CA_off' },
      { scheduleDelayMs: 999999 }
    );
    assert.equal(scheduled.scheduled, true);
  });
});

const fatTurns = [
  { speaker: 'caller', text: 'Hi, my name is Amina. Are you open on Sunday?' },
  { speaker: 'agent', text: 'Yes, 10 to 4.' },
];

describe('parseExtractedCallerName', () => {
  it('returns null for NONE', () => {
    assert.equal(parseExtractedCallerName('NONE'), null);
    assert.equal(parseExtractedCallerName('none'), null);
  });

  it('accepts a plausible name', () => {
    assert.equal(parseExtractedCallerName('Amina'), 'Amina');
    assert.equal(parseExtractedCallerName('"Brian"'), 'Brian');
    assert.equal(parseExtractedCallerName('Isha'), 'Aisha');
    assert.equal(parseExtractedCallerName('Asha'), 'Asha');
  });
});

describe('post-call contact persist and name extract', () => {
  it('upserts a contact with a null name when none is known', async () => {
    const upserts = [];
    const result = await persistCompletedCallContact(
      { callSid: 'CA_anon' },
      {
        getCall: async () => ({
          id: 'call-1',
          tenant_id: 't1',
          from_number: '+254712345678',
          name: null,
          reason: 'Hours',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-1', ...row };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].name, null);
    assert.equal(upserts[0].phone, '+254712345678');
    assert.equal(upserts[0].callId, 'call-1');
  });

  it('normalizes a Kenya local number and keeps a non-Kenya fallback', async () => {
    const upserts = [];
    const kenya = await persistCompletedCallContact(
      { callSid: 'CA_local' },
      {
        getCall: async () => ({
          id: 'call-local',
          tenant_id: 't1',
          from_number: '0712345678',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-local', ...row };
        },
      }
    );
    assert.equal(kenya.ok, true);
    assert.equal(upserts[0].phone, '+254712345678');

    const intl = await persistCompletedCallContact(
      { callSid: 'CA_intl' },
      {
        getCall: async () => ({
          id: 'call-intl',
          tenant_id: 't1',
          from_number: '+14155552671',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-intl', ...row };
        },
      }
    );
    assert.equal(intl.ok, true);
    assert.equal(upserts[1].phone, '+14155552671');
  });

  it('skips unknown phones', async () => {
    const result = await persistCompletedCallContact(
      { callSid: 'CA_unk' },
      {
        getCall: async () => ({
          id: 'call-2',
          tenant_id: 't1',
          from_number: 'unknown',
        }),
        upsertContact: async () => {
          throw new Error('should not upsert');
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no_phone');
  });

  it('canonicalizes a mangled saved name before contact upsert', async () => {
    const upserts = [];
    const result = await persistCompletedCallContact(
      { callSid: 'CA_isha' },
      {
        getCall: async () => ({
          id: 'call-isha',
          tenant_id: 't1',
          from_number: '+254712345679',
          name: 'Isha',
          reason: 'Hours',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-isha', ...row };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(upserts[0].name, 'Aisha');
  });

  it('does not upsert Haijawekwa as a contact name', async () => {
    const upserts = [];
    const result = await persistCompletedCallContact(
      { callSid: 'CA_junk' },
      {
        getCall: async () => ({
          id: 'call-junk',
          tenant_id: 't1',
          from_number: '+254712345680',
          name: 'Haijawekwa',
          reason: 'Emergency',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return { id: 'ct-junk', ...row };
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(upserts[0].name, null);
  });

  it('maps mocked Gemini NONE to a nameless upsert', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    const upserts = [];
    const result = await runPostCallHangupJobs(
      {
        callSid: 'CA_none',
        turns: fatTurns,
        summary: { name: null, reason: 'Sunday hours' },
      },
      {
        waitMs: 0,
        retryMs: 0,
        generateNameText: async () => 'NONE',
        generateText: async () => {
          throw new Error('review should not run');
        },
        getCall: async () => ({
          id: 'call-3',
          tenant_id: 't1',
          from_number: '+254700000001',
          name: null,
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return row;
        },
        save: async () => {
          throw new Error('should not save review');
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.extracted, null);
    assert.equal(upserts.length, 1);
    assert.equal(upserts[0].name, null);
  });

  it('feeds a mocked Gemini name into upsertContact', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'off';
    const upserts = [];
    const result = await runPostCallHangupJobs(
      {
        callSid: 'CA_name',
        turns: fatTurns,
        summary: { name: null, reason: 'Sunday hours' },
      },
      {
        waitMs: 0,
        retryMs: 0,
        generateNameText: async ({ system }) => {
          assert.match(system, /ONLY the name/);
          return 'Amina';
        },
        getCall: async () => ({
          id: 'call-4',
          tenant_id: 't1',
          from_number: '+254700000002',
          name: null,
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return row;
        },
      }
    );
    assert.equal(result.extracted, 'Amina');
    assert.equal(upserts[upserts.length - 1].name, 'Amina');
  });

  it('writes hangup owner reason onto contact last_reason', async () => {
    process.env.POST_CALL_GEMINI_REVIEW = 'on';
    const upserts = [];
    const result = await runPostCallHangupJobs(
      {
        callSid: 'CA_reason',
        turns: fatTurns,
        summary: { name: 'Colin', reason: 'Colin asked about Ah, unajua, degrees apartments.' },
        derived: { primaryIntent: 'book_visit', resolution: 'resolved' },
        toolFlags: { ...visitFlags, visitRequested: true },
      },
      {
        waitMs: 0,
        retryMs: 0,
        generateNameText: async () => 'Colin',
        generateText: async () =>
          JSON.stringify({
            want: 'Colin booked a mattress cleaning visit for tomorrow at 10 AM at Degrees Apartments in Rongai.',
            done: 'Visit saved.',
            mood: 'calm',
            next: 'Confirm the visit.',
            reason: 'Colin booked a visit tomorrow.',
            primary_intent: 'book_visit',
            needs_human: false,
            needs_owner: false,
            urgent: false,
            confidence: 0.94,
          }),
        getCall: async () => ({
          id: 'call-5',
          tenant_id: 't1',
          from_number: '+254119774470',
          name: 'Colin',
          reason: 'Colin asked about Ah, unajua, degrees apartments.',
        }),
        upsertContact: async (row) => {
          upserts.push(row);
          return row;
        },
        save: async () => {},
      }
    );
    assert.equal(result.ok, true);
    const last = upserts[upserts.length - 1];
    assert.equal(result.review.merged.reason, 'Visit request saved — confirm on desk.');
    assert.equal(result.review.merged.done, 'Visit request saved — confirm on desk.');
    assert.match(last.lastReason, /mattress cleaning visit/);
    assert.doesNotMatch(last.lastReason, /unajua/);
    assert.doesNotMatch(last.lastReason, /booked a visit|book that for you/i);
    assert.match(result.review.merged.want, /mattress cleaning visit/);
    assert.doesNotMatch(result.review.merged.want, /booked/i);
    assert.equal(result.review.review.mood, 'calm');
  });

  it('extractCallerNameFromTranscript maps NONE and a real name', async () => {
    const none = await extractCallerNameFromTranscript(fatTurns, {
      generateNameText: async () => 'NONE',
    });
    const named = await extractCallerNameFromTranscript(fatTurns, {
      generateNameText: async () => 'Jane',
    });
    assert.equal(none, null);
    assert.equal(named, 'Jane');
  });
});
