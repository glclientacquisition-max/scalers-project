'use strict';
// Every caller-facing catalogue read for a business with NO KB snapshot (legacy mode), as plain JSON.
// The KB reader PR must leave all of it byte-for-byte unchanged: tests/kbSource.test.js compares this against
// tests/fixtures/kbLegacyGolden.json, generated from the pre-PR staging tip (3a037cd9) with this same file.
// Fixture: tests/fixtures/dndSimTenant.json (staging sim tenant config, no call data). Synthetic phone only.
const path = require('node:path');
const root = path.join(__dirname, '..', '..');
const req = (p) => require(path.join(root, p));

function legacySurface() {
  const FR = require('../fixtures/dndSimTenant.json');
  const { tenantProfileFromRow } = req('src/tenantProfile');
  const { indexFieldMeta } = req('src/conversation/provenance');
  const inner = FR.picks.picks;
  const areaPicksRows = inner.picks.map((row) => ({ ...row, confirmed_at: FR.picks.confirmed_at, tree_version: inner.tree_version }));
  const mk = () => ({ ...tenantProfileFromRow(FR.row, { fieldMeta: indexFieldMeta(FR.meta), areaPicksRows }), id: FR.row.id });
  const now = new Date('2026-10-28T10:00:00+03:00');
  const out = {};
  const P = mk();
  out.liveGroundTruth = req('src/conversation/liveKnowledge').buildLiveGroundTruth(P);
  const GW = req('src/speech/greetingWarm');
  const gi = GW.greetingInputs(mk(), { now });
  out.greetingInputs = { ...gi, now: gi.now.toISOString() };
  out.fallbackGreeting = req('src/conversation/dynamicSpeech').fallbackGreeting(gi.businessName, { ...gi, variant: 0 });
  out.offeringClause = req('src/conversation/businessAssistantIntro').summarizeOfferingForIntro(gi);
  out.speechFactText = req('src/conversation/provenance').speechFactText(mk());
  const SG = req('src/conversation/speechGuard');
  out.guard = ['Deep Clean is 6,000 shillings.', 'Sofa cleaning is about 3,000 shillings.', 'We have carpet and sofa cleaning, 2,000 shillings.']
    .map((t) => { try { return SG.guardSpokenReply(t, { profile: mk(), lang: 'en' }); } catch (e) { return `ERR ${e.message}`; } });
  out.sttTerms = req('src/speech/sttContext').collectTenantTerms(mk());
  const NLU = req('src/conversation/v2/nlu');
  out.nlu = ['how much is a deep clean', 'do you do carpet cleaning?', 'mnafanya usafi wa sofa?', 'what services do you offer']
    .map((t) => { const u = NLU.understand(t, { profile: mk(), now }); return { kind: u.kind, service: u.service ? u.service.name : null, products: (u.products || []).length, intents: u.intents }; });
  const SC = req('src/knowledge/spokenCatalogue');
  const meta = SC.resolveSpokenCatalogueMeta(mk());
  out.spokenCatalogue = { stale: meta.stale, degraded: meta.degraded, doc: { ...meta.doc, generatedAt: null } };
  const { createState } = req('src/conversation/v2/machine');
  const T = req('src/conversation/v2/engineTools');
  out.tools = [['how much is a deep clean', { intent: 'ask', answers: ['price'], slots: { service: 'Deep Clean' } }], ['what do you do', { intent: 'ask', answers: ['services'], slots: {} }], ['do you do carpet cleaning?', { intent: 'ask', answers: [], slots: {} }]]
    .map(([text, u]) => { const p = mk(); const m = createState({ profile: p, callerPhone: '+254700000001', callId: 'KB_LEGACY_SNAPSHOT' }); return T.runTools({ understanding: u, machine: m, profile: p, lang: 'en', text, now }).receipts.map((r) => ({ ...r, ms: undefined, receipt_id: undefined })); });
  const ER = req('src/conversation/v2/engineReply');
  const ML = req('src/conversation/v2/modelLead');
  const p2 = mk(); const m2 = createState({ profile: p2, callerPhone: '+254700000001', callId: 'KB_LEGACY_SNAPSHOT' });
  const pack = ER.replyPack({ goal: { type: 'answer', answers: ['price'] }, text: 'how much is a deep clean', receipts: out.tools[0], machine: m2, lang: 'sw', caller: {}, profile: p2 });
  out.replyPack = pack;
  out.replyRequest = ML.replyRequest(pack, p2);
  const EG = req('src/conversation/v2/engineGuard');
  const ver = EG.makeEnginesVerifier({ st: { kind: 'answer', items: [], lang: 'sw' }, receipts: [], coverage: [], caller: {}, profile: p2, questions: [{ type: 'price' }], lang: 'sw', machine: m2, text: 'bei ya deep clean', u: {}, confirm: [] }, { allowed: new Set() });
  out.verifier = ['Usafi wa kina ni shilingi elfu sita.', 'Deep Clean ni shilingi elfu sita.', 'We have Deep Clean and Post-Construction Clean, 6,000 shillings.'].map((t) => ver.check(t));
  return JSON.parse(JSON.stringify(out));
}
module.exports = { legacySurface };
if (require.main === module) process.stdout.write(`${JSON.stringify(legacySurface(), null, 1)}\n`);
