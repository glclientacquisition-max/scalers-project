const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRetailIntent,
  missingRetailSlots,
  canCompleteRetailIntent,
  formatRetailPlaybookForPrompt,
} = require('../src/conversation/playbooks/retail');
const { formatPlaybookForPrompt } = require('../src/conversation/playbooks');
const { buildSystemPrompt } = require('../src/prompts');

describe('retail playbooks', () => {
  it('classifies common retail utterances', () => {
    assert.equal(classifyRetailIntent('Are you open now?'), 'hours_open');
    assert.equal(classifyRetailIntent('Where are you located?'), 'directions');
    assert.equal(classifyRetailIntent('How much is the charger?'), 'price');
    assert.equal(classifyRetailIntent('Do you have screen protectors in stock?'), 'availability');
    assert.equal(
      classifyRetailIntent('Hold two chargers for me, I will pick up at 5'),
      'hold_or_pickup'
    );
    assert.equal(classifyRetailIntent('I want to order a charger'), 'order_enquiry');
    assert.equal(classifyRetailIntent('What is your return policy?'), 'policy');
    assert.equal(classifyRetailIntent('Can I talk to the owner?'), 'human');
    assert.equal(classifyRetailIntent('Do you sell phone chargers?'), 'product_inquiry');
  });

  it('requires slots before hold completion', () => {
    assert.deepEqual(missingRetailSlots('hold_or_pickup', {}), [
      'product',
      'name',
      'when',
    ]);
    assert.equal(
      canCompleteRetailIntent('hold_or_pickup', {
        product: 'charger',
        name: 'Jane',
        when: 'evening',
      }),
      true
    );
    assert.equal(canCompleteRetailIntent('hours_open', {}), true);
  });

  it('injects retail playbook only for retail vertical', () => {
    const retail = formatPlaybookForPrompt({
      vertical: 'retail',
      handoffMode: 'callback',
    });
    assert.match(retail, /RETAIL PLAYBOOK/);
    assert.match(retail, /hold_or_pickup/);
    assert.match(retail, /create_service_request/);

    const general = formatPlaybookForPrompt({ vertical: 'general' });
    assert.equal(general, '');
  });

  it('puts retail playbook into system prompt for retail tenants', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Westlands Gadgets',
      agentName: 'Aisha',
      vertical: 'retail',
      handoffMode: 'callback',
      llmSystemPrompt: 'You are Aisha for Westlands Gadgets.',
      servicesCatalog: [
        { name: 'Phone charger', price_range: 'from 500', in_stock: 'yes' },
      ],
      businessLocations: [
        { label: 'Main', landmark: 'Opposite Naivas', address: 'Westlands' },
      ],
      agentTools: { escalate: true, end_call: true },
    });
    assert.match(prompt, /RETAIL PLAYBOOK/);
    assert.match(prompt, /hold_or_pickup/);
    assert.match(prompt, /In stock: yes/);
    assert.match(prompt, /Opposite Naivas/);
  });

  it('formats playbook text with handoff mode', () => {
    const text = formatRetailPlaybookForPrompt({ handoffMode: 'live_transfer' });
    assert.match(text, /live_transfer/);
    assert.match(text, /Completion rules/);
  });
});
