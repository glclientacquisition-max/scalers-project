'use strict';
// HD_89aa48bf657f: BRAIN_PLAIN_SERVICE_CATEGORIES (default off)
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/prompts');
const M = require('../src/conversation/catalogueMouth');

const st = () => ({ conversation: {}, caller: {}, language: { current: 'en' } });
const T5 = "I don't— I don't understand what you're saying by 1-Bedroom.";
const LIVE5 = 'Standard 1-Bedroom Apartment cleaning includes dusting, vacuuming, mopping, bathroom sanitation, and kitchen surfaces for three thousand shillings. Would you like to book that?';

test('flag off: prompt and mouth unchanged', () => {
  delete process.env.BRAIN_PLAIN_SERVICE_CATEGORIES;
  assert.equal(P.plainServiceCategoriesEnabled(), false);
  assert.equal(P.conversationRules(), P.CONVERSATION_RULES);
  assert.match(P.buildSystemPrompt({}), /you MUST read the catalogue/);
});

test('flag on: plain categories in the caller language, no early name ask, explain without push', () => {
  process.env.BRAIN_PLAIN_SERVICE_CATEGORIES = '1';
  try {
    const sys = P.buildSystemPrompt({});
    assert.doesNotMatch(sys, /you MUST read the catalogue|say those names exactly/);
    assert.match(sys, /usafi wa nyumba kulingana na ukubwa/);
    assert.match(sys, /Do not ask for their name until they have chosen a service/);
    assert.match(sys, /Reply in the language of the caller's latest clear turn/);
    const out = M.shapeCatalogueMouth(LIVE5, { state: st(), callerText: T5, profile: {} });
    assert.doesNotMatch(out, /book|shillings/i);
    assert.match(out, /dusting, vacuuming/);
    const sw = 'Tunafanya usafi wa magodoro, sofa na mazulia, usafi wa nyumba kulingana na ukubwa, usafi wa kina, na maofisi. Ungependa ipi?';
    assert.equal(M.shapeCatalogueMouth(sw, { state: { ...st(), language: { current: 'sw' } }, callerText: 'Uniambie huduma gani mnafanya.', profile: {} }), sw);
  } finally { delete process.env.BRAIN_PLAIN_SERVICE_CATEGORIES; }
});
