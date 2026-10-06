// Seed provenance, UNKNOWN compile, and the empty-catalogue hold gate.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  classifyFaq,
  buildCompileSections,
  holdOrdersEnabled,
  factFaqs,
} = require('../src/conversation/provenance');
const { buildLiveGroundTruth } = require('../src/conversation/liveKnowledge');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { guardSpokenReply } = require('../src/conversation/speechGuard');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const { buildSystemPrompt } = require('../src/prompts');

const SEED_FAQ = {
  question: 'Can you hold an item for me?',
  answer:
    'Yes. Tell us the item, your name, and when you will pick up, and we will log a hold.',
};

describe('gigo provenance', () => {
  it('caps an exact pack FAQ at suggested and not fact', () => {
    const row = classifyFaq(SEED_FAQ);
    assert.equal(row.fact, false);
    assert.equal(row.status, 'suggested');
    assert.equal(row.source, 'seed');
    const golden = classifyFaq({ ...SEED_FAQ, status: 'golden' });
    assert.equal(golden.fact, false);
    assert.equal(golden.status, 'suggested');
  });

  it('emits UNKNOWN and no seed answer for a seed-only compile', () => {
    const sections = buildCompileSections({
      faqs: [SEED_FAQ],
      businessPolicies: {
        deposit:
          'We can hold items for pickup when we have the caller name and pickup time.',
        payment: '',
      },
      productCatalog: [],
    });
    assert.equal(sections.faqBlock, '(none confirmed)');
    assert.doesNotMatch(sections.faqBlock, /log a hold/);
    assert.match(sections.unknownBlock, /UNKNOWN/);
    assert.match(sections.unknownBlock, /FAQ: Can you hold an item for me\?/);
    assert.match(sections.unknownBlock, /Holds/);
    assert.match(sections.unknownBlock, /Let me confirm with the owner/);
    assert.equal(sections.holdsAvailable, false);
    assert.doesNotMatch(sections.policiesText, /hold items for pickup/);
  });

  it('matches the dashboard compile twin', () => {
    const fixture = {
      faqs: [
        SEED_FAQ,
        { question: 'Do you have parking?', answer: 'Yes, behind the shop.' },
      ],
      businessPolicies: {
        payment: 'M-Pesa till 123456.',
        deposit:
          'We can hold items for pickup when we have the caller name and pickup time.',
      },
      policiesText:
        '- Payment: M-Pesa till 123456.\n- Holds: We can hold items for pickup when we have the caller name and pickup time.',
      productCatalog: [{ name: 'Diary', price: '350' }],
      productsText: 'Product catalogue:\n- Diary - 350',
      servicesText:
        'Services:\n- Home cleaning - price Quoted on site - House, Airbnb, and general clean visits.',
    };
    const js = buildCompileSections(fixture);
    const child = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '-e',
        `import { buildCompileSections } from './dashboard/src/lib/provenance.ts';
const fixture = ${JSON.stringify(fixture)};
process.stdout.write(JSON.stringify(buildCompileSections(fixture)));`,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, JSON.stringify(js));
  });

  it('does not put a seed FAQ in live confirmed facts', () => {
    const truth = buildLiveGroundTruth({
      faqs: [
        SEED_FAQ,
        { question: 'Do you have parking?', answer: 'Yes, behind the shop.' },
      ],
      businessPolicies: { payment: 'M-Pesa till 555000.' },
    });
    assert.match(truth, /CONFIRMED FAQs/);
    assert.doesNotMatch(truth, /GOLDEN/);
    assert.match(truth, /Yes, behind the shop/);
    assert.doesNotMatch(truth, /we will log a hold/);
    assert.match(truth, /UNKNOWN/);
    assert.match(truth, /M-Pesa till 555000/);
  });

  it('saves an enquiry and speaks no hold when the catalogue is empty', async () => {
    const parsed = parseGeminiResponse(
      'I\'ve held it for you. ###TOOL###{"create_service_request":{"type":"hold","name":"Jane","item":"Diary","when_text":"tomorrow"}}###ENDTOOL###'
    );
    let saved = null;
    const execution = await executeBrainTools({
      parsed,
      capabilities: { createServiceRequest: true },
      productCatalog: [],
      handlers: {
        createServiceRequest: async (request) => {
          saved = request;
          return { id: '1', request_type: request.type };
        },
      },
    });
    assert.equal(saved.type, 'enquiry');
    const confirm = formatToolConfirmation(execution.results, 'en');
    assert.doesNotMatch(confirm, /\bheld\b|\breserved\b/i);
    const spoken = guardSpokenReply("I've held it for you.", {
      toolResults: execution.results,
      profile: {},
    });
    assert.doesNotMatch(spoken, /\bheld\b|\breserved\b/i);
  });

  it('answers an enquiry from incomplete confirmed facts', () => {
    const prompt = buildSystemPrompt({
      businessName: 'Westlands Gadgets',
      agentName: 'Aisha',
      vertical: 'retail',
      faqs: [
        SEED_FAQ,
        { question: 'Where is the shop?', answer: 'Opposite Naivas, Westlands.' },
      ],
      productCatalog: [],
    });
    assert.match(prompt, /Opposite Naivas, Westlands/);
    assert.match(prompt, /UNKNOWN/);
    assert.match(prompt, /take-a-message always work/i);
    assert.match(prompt, /Holds and orders are not available/);
    assert.doesNotMatch(prompt, /we will log a hold/);
    assert.equal(holdOrdersEnabled({ productCatalog: [], businessPolicies: {} }), false);
    assert.equal(factFaqs([SEED_FAQ]).length, 0);
  });
});
