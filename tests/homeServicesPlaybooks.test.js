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
    assert.match(text, /Never invent prices/);
  });
});
