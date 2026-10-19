'use strict';

// Permanent guard: whenever VOICE_STREAM_RECORD records the call, the opener
// tells the caller (Kenya DPA). Off means no notice, so the two cannot drift.

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { composeBusinessAssistantIntro, introLooksValid } = require('../src/conversation/businessAssistantIntro');
const { generateDynamicGreeting } = require('../src/conversation/dynamicSpeech');
const { RECORDING_NOTICE_EN, recordingNoticeOn } = require('../src/conversation/recordingNotice');

const NOON = new Date('2026-10-19T09:00:00.000Z'); // 12:00 EAT, afternoon (no day word)
const prev = { rec: process.env.VOICE_STREAM_RECORD, greet: process.env.VOICE_GREETING };

afterEach(() => {
  if (prev.rec === undefined) delete process.env.VOICE_STREAM_RECORD;
  else process.env.VOICE_STREAM_RECORD = prev.rec;
  if (prev.greet === undefined) delete process.env.VOICE_GREETING;
  else process.env.VOICE_GREETING = prev.greet;
});

describe('recording notice in the opener', () => {
  it('flag parsing matches the Stream record flag', () => {
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE']) assert.equal(recordingNoticeOn({ VOICE_STREAM_RECORD: v }), true);
    for (const v of ['', '0', 'off', 'false', undefined]) assert.equal(recordingNoticeOn({ VOICE_STREAM_RECORD: v }), false);
  });

  it('is absent when recording is off', () => {
    delete process.env.VOICE_STREAM_RECORD;
    const line = composeBusinessAssistantIntro({ businessName: 'Aris Stationeries', agentName: 'Amani', now: NOON });
    assert.equal(line, 'Aris Stationeries, this is Amani. How can I help?');
  });

  it('is said in every opener branch when recording is on', () => {
    process.env.VOICE_STREAM_RECORD = '1';
    const base = { businessName: 'Aris Stationeries', agentName: 'Amani', now: NOON };
    const variants = [
      {},
      { isOpen: false },
      { isOpen: false, afterHoursMode: 'message' },
      { afterHoursMode: 'message' },
      { closureNotice: 'Closed for stock-taking today' },
      { vertical: 'home_services' },
    ];
    for (const extra of variants) {
      const line = composeBusinessAssistantIntro({ ...base, ...extra });
      assert.ok(line.startsWith(`Aris Stationeries, this is Amani. ${RECORDING_NOTICE_EN} `), line);
      assert.equal(line.split(RECORDING_NOTICE_EN).length, 2, `said once: ${line}`);
      assert.ok(introLooksValid(line, 'Aris Stationeries', 'Amani', { ...base, ...extra }), `valid: ${line}`);
    }
  });

  it('an explicit recordingNotice option wins over the env', () => {
    process.env.VOICE_STREAM_RECORD = '1';
    const off = composeBusinessAssistantIntro({ businessName: 'Aris', agentName: 'Amani', now: NOON, recordingNotice: false });
    assert.ok(!off.includes(RECORDING_NOTICE_EN));
  });

  it('live greeting path (instant and gemini mode) keeps the notice', async () => {
    process.env.VOICE_STREAM_RECORD = '1';
    const instant = await generateDynamicGreeting({ businessName: 'Aris', agentName: 'Amani', mode: 'instant', now: NOON });
    assert.ok(instant.includes(RECORDING_NOTICE_EN), instant);
    let asked = false;
    const gemini = await generateDynamicGreeting({
      businessName: 'Aris', agentName: 'Amani', mode: 'gemini', now: NOON,
      generateText: async () => { asked = true; return 'Aris, this is Amani. How can I help?'; },
    });
    assert.equal(asked, false, 'no rewrite that could drop the notice');
    assert.ok(gemini.includes(RECORDING_NOTICE_EN), gemini);
  });

  it('a fixed VOICE_GREETING gets the notice appended once', async () => {
    process.env.VOICE_STREAM_RECORD = '1';
    process.env.VOICE_GREETING = 'Hello, Aris here.';
    assert.equal(await generateDynamicGreeting({ businessName: 'Aris' }), `Hello, Aris here. ${RECORDING_NOTICE_EN}`);
    process.env.VOICE_GREETING = 'Hello, Aris here. Calls are recorded.';
    assert.equal(await generateDynamicGreeting({ businessName: 'Aris' }), 'Hello, Aris here. Calls are recorded.');
  });
});
