// VOICE_RECORDING_NOTICE_OWED (22 Oct 2026). Prod HD_fc807a3ee344 and
// HD_2ccfbf6e1fa4: a barge cut the greeting before the notice and nothing
// said it again; calls.notice_given had no writer.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  RECORDING_NOTICE_EN,
  RECORDING_NOTICE_SW,
  recordingNoticeOwedEnabled,
  inviteNoticeLanguage,
  recordingNoticeLine,
  createRecordingNoticeState,
} = require('../src/conversation/recordingNotice');
const { composeBusinessAssistantIntro } = require('../src/conversation/businessAssistantIntro');

describe('flag', () => {
  it('only the exact value on enables it', () => {
    assert.equal(recordingNoticeOwedEnabled({}), false);
    assert.equal(recordingNoticeOwedEnabled({ VOICE_RECORDING_NOTICE_OWED: 'true' }), false);
    assert.equal(recordingNoticeOwedEnabled({ VOICE_RECORDING_NOTICE_OWED: '1' }), false);
    assert.equal(recordingNoticeOwedEnabled({ VOICE_RECORDING_NOTICE_OWED: 'on' }), true);
  });
});

describe('notice language', () => {
  it('Kiswahili invite gets the Kiswahili notice only with the flag on', () => {
    assert.equal(inviteNoticeLanguage('Nikusaidie vipi'), 'sw');
    assert.equal(inviteNoticeLanguage('How can I help?'), 'en');
    assert.equal(recordingNoticeLine({ greetingInvite: 'Nikusaidie vipi', owedFlag: true }), RECORDING_NOTICE_SW);
    assert.equal(recordingNoticeLine({ greetingInvite: 'Nikusaidie vipi', owedFlag: false }), RECORDING_NOTICE_EN);
    assert.equal(recordingNoticeLine({ greetingInvite: '', owedFlag: true }), RECORDING_NOTICE_EN);
  });
  it('opener uses it; flag off keeps today\'s opener', () => {
    const base = { businessName: 'Esga', agentName: 'Lucy', greetingInvite: 'Nikusaidie vipi', isOpen: true, recordingNotice: true, now: new Date('2026-10-20T05:05:00Z') };
    const on = composeBusinessAssistantIntro({ ...base, recordingNoticeOwed: true });
    const off = composeBusinessAssistantIntro({ ...base, recordingNoticeOwed: false });
    assert.equal(on, 'Good morning, Esga, this is Lucy. Simu hii inaweza kurekodiwa. Nikusaidie vipi.');
    assert.equal(off, 'Good morning, Esga, this is Lucy. This call may be recorded. Nikusaidie vipi.');
    const en = composeBusinessAssistantIntro({ ...base, greetingInvite: '', recordingNoticeOwed: true });
    assert.match(en, /This call may be recorded\./);
  });
});

describe('notice state', () => {
  it('full greeting play gives the notice once and writes once', () => {
    const given = [];
    const st = createRecordingNoticeState({ onGiven: (how) => given.push(how) });
    assert.equal(st.greetingPlayed({ noticeInGreeting: true, cut: false }), 'given');
    assert.equal(st.takeOwedPrefix(), '');
    assert.deepEqual(given, ['greeting']);
  });
  it('a cut greeting owes the notice: said once at the next agent line, given after a full play', () => {
    const given = [];
    const st = createRecordingNoticeState({ line: RECORDING_NOTICE_SW, onGiven: (how) => given.push(how) });
    assert.equal(st.greetingPlayed({ noticeInGreeting: true, cut: true }), 'owed');
    assert.deepEqual(given, [], 'not written while owed');
    assert.equal(st.takeOwedPrefix(), RECORDING_NOTICE_SW);
    assert.equal(st.takeOwedPrefix(), '', 'never twice in flight (no double-speak)');
    assert.equal(st.owedLinePlayed({ cut: false }), 'given');
    assert.deepEqual(given, ['owed_line']);
    assert.equal(st.takeOwedPrefix(), '');
  });
  it('an owed line cut again stays owed, then gives up after 2 tries', () => {
    const given = [];
    const st = createRecordingNoticeState({ onGiven: (how) => given.push(how) });
    st.greetingPlayed({ noticeInGreeting: true, cut: true });
    assert.ok(st.takeOwedPrefix());
    assert.equal(st.owedLinePlayed({ cut: true }), 'owed');
    assert.ok(st.takeOwedPrefix());
    assert.equal(st.owedLinePlayed({ cut: true }), 'gave_up');
    assert.equal(st.takeOwedPrefix(), '');
    assert.deepEqual(given, []);
  });
  it('a line that never played does not use an attempt', () => {
    const st = createRecordingNoticeState({});
    st.greetingPlayed({ noticeInGreeting: true, cut: true });
    st.takeOwedPrefix();
    st.owedLinePlayed({ cut: true, skipped: true });
    assert.equal(st.attempts(), 0);
    assert.ok(st.takeOwedPrefix());
  });
  it('no notice in the greeting (not recording): nothing owed, nothing written', () => {
    const given = [];
    const st = createRecordingNoticeState({ onGiven: (how) => given.push(how) });
    assert.equal(st.greetingPlayed({ noticeInGreeting: false, cut: true }), 'not_required');
    assert.equal(st.takeOwedPrefix(), '');
    assert.deepEqual(given, []);
  });
  it('onGiven throwing never breaks the call', () => {
    const st = createRecordingNoticeState({ onGiven: () => { throw new Error('db down'); } });
    assert.equal(st.greetingPlayed({ noticeInGreeting: true }), 'given');
  });
});

describe('server wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  it('owed prefix skips fillers, replays, nudges and the greeting', () => {
    const block = src.slice(src.indexOf('const owedEligible ='), src.indexOf('const prefix = owedEligible'));
    for (const k of ['isFiller', 'isReplay', 'isIdleNudge', 'isGreeting']) assert.match(block, new RegExp(`!opts\\.${k}`));
  });
  it('given needs a play with no barge', () => {
    assert.match(src, /const played = Boolean\(spoken\?\.ok\) && bargeCancelCount === bargesBefore;/);
    assert.match(src, /bargeCancelCount \+= 1;/);
  });
  it('the writer goes through db.markCallNoticeGiven', () => {
    assert.match(src, /db\.markCallNoticeGiven\(sessionCallSid\)/);
    const db = fs.readFileSync(path.join(__dirname, '..', 'src', 'db.js'), 'utf8');
    assert.match(db, /\.update\(\{ notice_given: true \}\)/);
    assert.doesNotMatch(db, /notice_given: false/);
  });
});
