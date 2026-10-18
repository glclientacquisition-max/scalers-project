'use strict';

// Caller recording notice (Kenya Data Protection Act: tell callers before recording).
// Spoken in the opener only while VOICE_STREAM_RECORD asks SautiKit to record,
// so the notice and the recording can never drift apart.

const RECORDING_NOTICE_EN = 'This call may be recorded.';
const RECORDING_NOTICE_SW = 'Simu hii inaweza kurekodiwa.';

function recordingNoticeOn(env = process.env) {
  return /^(1|true|on|yes)$/i.test(String(env.VOICE_STREAM_RECORD || '').trim());
}

module.exports = { RECORDING_NOTICE_EN, RECORDING_NOTICE_SW, recordingNoticeOn };
