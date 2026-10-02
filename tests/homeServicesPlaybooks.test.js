const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyHomeIntent,
  looksLikeVisitClassCleaningUrgency,
  looksLikeTrueHomeEmergency,
  isVisitClassEscalateReason,
  missingHomeSlots,
  canCompleteHomeIntent,
  formatHomeServicesPlaybookForPrompt,
} = require('../src/conversation/playbooks/homeServices');
const { formatPlaybookForPrompt } = require('../src/conversation/playbooks');

describe('home services playbooks', () => {
  it('classifies common home-services utterances', () => {
    assert.equal(classifyHomeIntent('Can you come tomorrow to fix my sink?'), 'book_visit');
    assert.equal(classifyHomeIntent('Do you cover Westlands?'), 'service_area');
    assert.equal(classifyHomeIntent('How much for an installation?'), 'price_band');
    assert.equal(classifyHomeIntent('Please cancel my appointment'), 'cancel');
    assert.equal(classifyHomeIntent('Reschedule to Friday afternoon'), 'reschedule');
    assert.equal(classifyHomeIntent('There is a burst pipe emergency'), 'emergency');
  });

  it('treats cleaning jobs as visits, not emergencies', () => {
    assert.equal(
      classifyHomeIntent('Urgent Airbnb clean tomorrow in Runda'),
      'book_visit'
    );
    assert.equal(
      classifyHomeIntent('I need my carpet cleaned tomorrow'),
      'book_visit'
    );
    assert.equal(
      classifyHomeIntent('Please clean my sofa near Rongai at 10 AM'),
      'book_visit'
    );
    assert.equal(
      classifyHomeIntent('Do you do mattress cleaning?'),
      'service_inquiry'
    );
    assert.equal(
      classifyHomeIntent('Do you do upholstery?'),
      'service_inquiry'
    );
    assert.equal(
      classifyHomeIntent('How much for carpet cleaning?'),
      'price_band'
    );
    assert.equal(
      classifyHomeIntent('Can you come fix my leaking tap tomorrow?'),
      'book_visit'
    );
  });

  it('pack #10: emergency Airbnb cleanup now is visit class not escalate reason', () => {
    const line =
      'Urgent emergency air bnb cleanup needed now in Westlands';
    assert.equal(classifyHomeIntent(line), 'book_visit');
    assert.equal(looksLikeVisitClassCleaningUrgency(line), true);
    assert.equal(looksLikeTrueHomeEmergency(line), false);
    assert.equal(isVisitClassEscalateReason(line), true);
  });

  it('out-of-scope plumber repair ask is not true emergency', () => {
    const line = 'Can you send a plumber to fix the pipe under my sink?';
    assert.equal(looksLikeTrueHomeEmergency(line), false);
    assert.equal(classifyHomeIntent(line), 'book_visit');
  });

  it('pack #11: garbled burst pipe is true emergency', () => {
    assert.equal(looksLikeTrueHomeEmergency('papers bust in the kitchen'), true);
    assert.equal(looksLikeTrueHomeEmergency('pipehas everywhere'), true);
    assert.equal(classifyHomeIntent('papers bust flooding'), 'emergency');
    assert.equal(looksLikeVisitClassCleaningUrgency('papers bust'), false);
  });

  it('reserves emergency for burst flood fire gas or shock', () => {
    assert.equal(
      classifyHomeIntent('Emergency burst pipe flooding the kitchen'),
      'emergency'
    );
    assert.equal(classifyHomeIntent('There is a gas leak'), 'emergency');
    assert.equal(
      classifyHomeIntent('This is urgent, book house cleaning tomorrow'),
      'book_visit'
    );
  });

  it('requires slots before book_visit completion', () => {
    assert.deepEqual(
      missingHomeSlots('book_visit', { service: 'plumbing' }),
      ['name', 'when', 'location']
    );
    assert.equal(
      canCompleteHomeIntent('book_visit', {
        service: 'plumbing',
        name: 'Amina',
        when: 'tomorrow 3pm',
        location: 'near Sarit Centre',
      }),
      true
    );
    assert.equal(
      canCompleteHomeIntent('book_visit', {
        service: 'plumbing',
        name: 'Amina',
        when: 'tomorrow 3pm',
        landmark: 'near Sarit Centre',
      }),
      true
    );
  });

  it('injects home playbook only for home_services vertical', () => {
    assert.equal(formatPlaybookForPrompt({ vertical: 'retail' }).includes('HOME SERVICES'), false);
    assert.equal(formatPlaybookForPrompt({ vertical: 'hospitality' }), '');
    const block = formatPlaybookForPrompt({ vertical: 'home_services' });
    assert.match(block, /HOME SERVICES PLAYBOOK/);
    assert.match(block, /create_appointment/);
    assert.match(block, /book_visit/);
  });

  it('formats playbook text with handoff mode', () => {
    const text = formatHomeServicesPlaybookForPrompt({ handoffMode: 'callback' });
    assert.match(text, /Handoff mode.*callback/);
    assert.match(text, /VISIT SOP/);
    assert.match(text, /Never invent prices/);
    assert.match(text, /not emergency/);
    assert.match(text, /never ask for the name again/);
    assert.match(text, /Where should we come/);
    assert.match(text, /Tuje wapi/);
    assert.match(text, /confirm access/);
    assert.match(text, /Never say landmark/);
    assert.doesNotMatch(text, /then landmark/);
    assert.doesNotMatch(text, /landmark\/address/);
  });
});
