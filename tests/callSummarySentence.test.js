// Run: node --test tests/callSummarySentence.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  displayContactLastReason,
  pickCallOwnerCard,
  pickCallOwnerReason,
  pickCallOwnerWant,
  shapeTicketChat,
  usefulMoodLabel,
  usefulOwnerFact,
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

  it('uses the same hangup reason on Contacts last reason as Inbox', () => {
    const meta = {
      reason: 'aje asked about Bwana Ken.',
      owner_review: {
        want: 'Ken called in but was confused about his booking and name, so Shy handled the general enquiry.',
        done: 'Hours answered.',
        mood: 'confused',
        next: 'Nothing.',
        reason: 'Ken was confused about his booking.',
      },
    };
    assert.match(pickCallOwnerReason(meta), /confused about his booking\.$/);
    assert.doesNotMatch(pickCallOwnerReason(meta), /so Shy handled/);
    assert.match(pickCallOwnerWant(meta), /so Shy handled/);
    const card = pickCallOwnerCard(meta);
    assert.equal(card.done, 'Hours answered.');
    assert.equal(card.mood, 'confused');
    assert.equal(card.next, 'Nothing.');
    const shown = displayContactLastReason({
      name: 'Ken',
      phone: '+254790381872',
      lastReason: 'aje asked about Bwana Ken.',
      latestCallReason: pickCallOwnerReason(meta),
    });
    assert.match(shown, /confused about his booking/);
    assert.doesNotMatch(shown, /aje asked/);
    assert.doesNotMatch(shown, /so Shy handled/);
  });

  it('treats None and Unknown as unset so next does not unlock empty rows', () => {
    assert.equal(usefulOwnerFact('None'), '');
    assert.equal(usefulOwnerFact('None.'), '');
    assert.equal(usefulOwnerFact('Call them back'), 'Call them back');
    assert.equal(usefulMoodLabel('unknown'), '');
    assert.equal(usefulMoodLabel('Unknown'), '');
    assert.equal(usefulMoodLabel(''), '');
    assert.equal(usefulMoodLabel('upset'), 'Upset');
    const page = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/app/(desk)/contacts/[id]/page.tsx'),
      'utf8'
    );
    const history = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/lib/contactHistoryView.ts'),
      'utf8'
    );
    assert.match(page, /usefulOwnerFact\(latestCall\?\.ownerCard\?\.done\)/);
    assert.match(page, /usefulMoodLabel\(latestCall\?\.ownerCard\?\.mood\)/);
    assert.match(page, /mood=\{ownerMood \|\| null\}/);
    assert.doesNotMatch(page, /ownerCard\?\.mood \|\|/);
    assert.match(history, /usefulOwnerFact\(card\.done\)/);
    assert.match(history, /usefulMoodLabel\(card\.mood\)/);
    const callPage = fs.readFileSync(
      path.join(__dirname, '../dashboard/src/app/(desk)/calls/[id]/page.tsx'),
      'utf8'
    );
    assert.match(callPage, /shapeTicketChat\(/);
    assert.match(callPage, /isSilenceCallStatus\(row\.status\) && !talked/);
    assert.doesNotMatch(callPage, /moodKey !== "unknown"/);
  });
});

describe('call chat card occasions', () => {
  it('shows No conversation for silence and keeps the clock as the banner', () => {
    const card = shapeTicketChat({
      silence: true,
      want: 'They asked for a quote.',
      done: 'Callback was noted.',
      mood: 'upset',
      next: 'Call them back.',
      needsYou: true,
      stamp: 'Missed',
      whenLabel: 'Today, 9:04 AM',
    });
    assert.equal(card.want, 'No conversation.');
    assert.equal(card.done, '');
    assert.equal(card.mood, '');
    assert.equal(card.urgency, '');
    assert.equal(card.bannerWhen, 'Today, 9:04 AM');
  });

  it('keeps Want, Done, and next on a talked call', () => {
    const card = shapeTicketChat({
      silence: false,
      want: 'Carpet cleaning in Runda in the morning. No name.',
      done: 'None.',
      mood: 'unknown',
      next: 'Call them back.',
      needsYou: true,
      stamp: 'Human asked',
      whenLabel: 'Today, 9:04 AM',
    });
    assert.equal(card.want, 'Carpet cleaning in Runda in the morning. No name.');
    assert.equal(card.done, '');
    assert.equal(card.mood, '');
    assert.equal(card.urgency, 'Call them back.');
    assert.equal(card.bannerWhen, '');
  });

  it('leaves the banner off when the receptionist finished the call', () => {
    const card = shapeTicketChat({
      silence: false,
      want: 'Sunday hours.',
      done: 'Hours answered.',
      mood: 'calm',
      next: 'None.',
      needsYou: false,
      stamp: 'Answered',
    });
    assert.equal(card.done, 'Hours answered.');
    assert.equal(card.mood, 'Calm');
    assert.equal(card.urgency, '');
    assert.equal(card.bannerWhen, '');
  });
});
