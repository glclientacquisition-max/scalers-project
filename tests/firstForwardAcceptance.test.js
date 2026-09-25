const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFirstForwardAcceptance,
  FIRST_FORWARD_BUCKETS,
  JUDGED_BUCKETS,
} = require('../src/conversation/firstForwardAcceptance');

const FIXTURES = [
  {
    name: 'flash under 3s with no speech',
    input: {
      durationSeconds: 2,
      greetingPlayed: false,
      hasStt: false,
      firstCallerTurn: '',
    },
    bucket: 'flash',
    judge: false,
  },
  {
    name: 'flash even if greeting started under 3s',
    input: {
      durationSeconds: 1.4,
      greetingPlayed: true,
      hasStt: false,
      connectToGreetingPcmMs: 900,
    },
    bucket: 'flash',
    judge: false,
  },
  {
    name: 'heard greeting then silent drop',
    input: {
      durationSeconds: 8,
      greetingPlayed: true,
      hasStt: false,
      firstCallerTurn: '',
      connectToGreetingPcmMs: 740,
    },
    bucket: 'heard_greeting_drop',
    judge: false,
  },
  {
    name: 'barged a job noun',
    input: {
      durationSeconds: 12,
      greetingPlayed: true,
      hasStt: true,
      bargedJob: true,
      bargeText: 'carpet cleaning tomorrow',
      firstCallerTurn: 'carpet cleaning tomorrow',
    },
    bucket: 'barged_job',
    judge: true,
  },
  {
    name: 'first turn has a goal',
    input: {
      durationSeconds: 22,
      greetingPlayed: true,
      hasStt: true,
      bargedJob: false,
      firstCallerTurn: 'I need a house clean tomorrow morning',
    },
    bucket: 'first_turn_goal',
    judge: true,
  },
  {
    name: 'hello only is not a goal',
    input: {
      durationSeconds: 18,
      greetingPlayed: true,
      hasStt: true,
      firstCallerTurn: 'Hello',
    },
    bucket: null,
    judge: false,
  },
  {
    name: 'hangup only is not a goal',
    input: {
      durationSeconds: 9,
      greetingPlayed: true,
      hasStt: true,
      firstCallerTurn: 'Bye',
    },
    bucket: null,
    judge: false,
  },
];

describe('first-forward acceptance classifier', () => {
  it('documents the four buckets and who is judged', () => {
    assert.deepEqual(FIRST_FORWARD_BUCKETS, [
      'flash',
      'heard_greeting_drop',
      'barged_job',
      'first_turn_goal',
    ]);
    assert.deepEqual(JUDGED_BUCKETS, ['barged_job', 'first_turn_goal']);
  });

  for (const row of FIXTURES) {
    it(row.name, () => {
      const out = classifyFirstForwardAcceptance(row.input);
      assert.equal(out.bucket, row.bucket);
      assert.equal(out.judge, row.judge);
    });
  }
});
