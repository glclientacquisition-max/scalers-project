// Seed provenance, UNKNOWN compile, and the empty-catalogue hold gate.

// Fixtures here use P0 owner rows (no value_hash). An ambient FACT_HASH_MODE=on
// in the shell must not flip them; hash-mode cases set the flag per test.
delete process.env.FACT_HASH_MODE;
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const {
  classifyFaq,
  buildCompileSections,
  holdOrdersEnabled,
  factFaqs,
  factServices,
  indexFieldMeta,
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
        // provenance.ts imports './factHash' (extensionless, as Next resolves it).
        '--import',
        './tests/registerTs.mjs',
        '--input-type=module',
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

  it('prefers tenant_field_meta and falls back when a row is missing', () => {
    const ownerFaq = { question: 'Where is the shop?', answer: 'Opposite Naivas, Westlands.' };
    assert.equal(factFaqs([ownerFaq]).length, 1);
    const seeded = indexFieldMeta([{ field_path: 'faqs.1', source: 'seed' }]);
    assert.equal(factFaqs([ownerFaq], seeded).length, 0);
    const sections = buildCompileSections({
      businessPolicies: { payment: 'Till 999111 at the counter.' },
      fieldMeta: indexFieldMeta([{ field_path: 'policies.payment', source: 'seed' }]),
    });
    assert.doesNotMatch(sections.policiesText, /999111/);
    assert.match(sections.unknownBlock, /Payment/);
    const unmarked = buildCompileSections({
      businessPolicies: { payment: 'Till 999111 at the counter.' },
    });
    assert.match(unmarked.policiesText, /999111/);
  });

  it('treats the staging seed envelope as not fact and holds closed', () => {
    const paths = [
      'faqs.1',
      'faqs.2',
      'faqs.3',
      'faqs.4',
      'faqs.5',
      'faqs.6',
      'catalog.service.1.name',
      'catalog.service.2.name',
      'catalog.service.3.name',
      'catalog.service.4.name',
      'catalog.service.5.name',
      'policies.payment',
    ];
    const fieldMeta = indexFieldMeta(paths.map((field_path) => ({ field_path, source: 'seed' })));
    const faqs = paths
      .filter((path) => path.startsWith('faqs.'))
      .map((path, index) => ({ question: `Question ${index}`, answer: `Answer written for ${path}` }));
    const services = [1, 2, 3, 4, 5].map((n) => ({
      name: `Visit ${n}`,
      price_range: 'KES 1500',
      notes: 'Owner notes',
    }));
    assert.equal(factFaqs(faqs, fieldMeta).length, 0);
    assert.equal(factServices(services, fieldMeta).length, 0);
    assert.equal(
      holdOrdersEnabled({
        productCatalog: [{ name: 'Diary', holdable: true }],
        businessPolicies: { deposit: 'Hold until 6pm with the caller name.' },
        fieldMeta,
        holdGate: {
          allowed: false,
          reasons: [
            'Holds are not enabled in policies.',
            'Need at least one holdable product with owner provenance in the catalog.',
          ],
        },
      }),
      false
    );
  });

  it('uses tenant_hold_gate when the RPC answered', () => {
    const profile = {
      productCatalog: [{ name: 'Diary' }],
      businessPolicies: { deposit: 'Hold until 6pm with the caller name.' },
    };
    assert.equal(holdOrdersEnabled(profile), true);
    assert.equal(
      holdOrdersEnabled({
        ...profile,
        holdGate: { allowed: false, reasons: ['Need a verified notify target.'] },
      }),
      false
    );
    assert.equal(
      holdOrdersEnabled({
        ...profile,
        holdGate: { allowed: false, reasons: ['provenance_rpc_missing'] },
      }),
      true
    );
  });

  it('does not speak a deposit amount or payment number during a hold', () => {
    const toolResults = [
      { action: 'create_service_request', status: 'succeeded', requestType: 'hold' },
    ];
    const mixed = guardSpokenReply(
      "Okay, I've saved your request. The deposit is 2000 to till 555111.",
      { toolResults, profile: {} }
    );
    assert.match(mixed, /saved your request/i);
    assert.doesNotMatch(mixed, /2000|555111|till|deposit/i);
    const onlyMoney = guardSpokenReply('Send the deposit of 2000 to till 555111.', {
      toolResults,
      profile: {},
    });
    assert.equal(onlyMoney, 'The owner will follow up.');
    assert.doesNotMatch(onlyMoney, /2000|555111/);
    const payAnswer = guardSpokenReply('Pay on till 555111.', {
      toolResults: [],
      profile: { businessPolicies: { payment: 'Pay on till 555111.' } },
    });
    assert.match(payAnswer, /555111/);
  });
});
