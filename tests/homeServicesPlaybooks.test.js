const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyHomeIntent,
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
      ['name', 'when', 'landmark']
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
  });
});
