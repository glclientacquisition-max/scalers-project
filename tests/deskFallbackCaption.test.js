'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireRoot = createRequire(path.join(__dirname, '..', 'package.json'));
const { lineForKind, DEFAULT_BY_KIND } = requireRoot('./src/conversation/unknownAnswerByKind.js');

const GENERIC = 'Let me check with the team and get back to you.';
const QUOTE = DEFAULT_BY_KIND.price.en;

function deskSpoken(kind, byKind, lang, legacyGeneral) {
  return lineForKind(byKind, kind, lang, {
    unknownAnswerFallback: legacyGeneral || '',
    unknownAnswerByKind: byKind,
  });
}

describe('desk fallback caption (spokenFallbackLine parity)', () => {
  it('empty byKind with generic legacy uses the same line on caption as voice for each kind', () => {
    for (const kind of ['price', 'hours', 'fee', 'pay']) {
      const spoken = deskSpoken(kind, null, 'en', GENERIC);
      assert.equal(spoken, GENERIC, kind);
    }
  });

  it('quote-style legacy applies to price only, not hours', () => {
    assert.equal(deskSpoken('price', null, 'en', QUOTE), QUOTE);
    assert.equal(deskSpoken('hours', null, 'en', QUOTE), DEFAULT_BY_KIND.hours.en);
  });

  it('per-kind owner line wins over legacy general', () => {
    const byKind = { hours: { en: 'Custom hours line for callers.', sw: '' } };
    assert.equal(deskSpoken('hours', byKind, 'en', GENERIC), 'Custom hours line for callers.');
  });
});
