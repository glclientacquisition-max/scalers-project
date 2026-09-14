// Run: node --test tests/callSummarySentence.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  displayContactLastReason,
  pickCallOwnerReason,
} = require('../dashboard/src/lib/callSummarySentence');

describe('contact last reason matches call summary', () => {
  it('prefers hangup owner_review over the stored fragment', () => {
    const latest = pickCallOwnerReason({
      reason: 'aje asked about Bwana Ken.',
      owner_review: {
        reason:
          'Ken called in but was confused about his booking and name, so Shy handled the general enquiry.',
      },
    });
    const shown = displayContactLastReason({
      name: 'Alvin',
      phone: '+254790381872',
      lastReason: 'aje asked about Bwana Ken.',
      latestCallReason: latest,
    });
    assert.match(shown, /confused about his booking/);
    assert.doesNotMatch(shown, /aje asked/);
  });

  it('uses the visit sentence instead of a mid-call STT fragment', () => {
    const shown = displayContactLastReason({
      name: 'Colin',
      phone: '+254119774470',
      lastReason: 'Colin asked about Ah, unajua, degrees apartments.',
      latestCallReason:
        'Colin booked a mattress cleaning visit for tomorrow at 10 AM at Degrees Apartments in Rongai',
    });
    assert.match(shown, /mattress cleaning visit/);
    assert.doesNotMatch(shown, /unajua/);
  });

  it('stays empty when nothing was captured', () => {
    assert.equal(
      displayContactLastReason({
        name: null,
        phone: '+254700000000',
        lastReason: null,
        latestCallReason: null,
      }),
      null
    );
  });
});
