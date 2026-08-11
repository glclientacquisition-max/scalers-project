const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Mirror of dashboard isProseServiceName for voice/docs parity smoke.
function isProseServiceName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n.length > 80) return true;
  if (/^\d+[\.)]\s/.test(n)) return true;
  if (
    /\b(business identity|service philosophy|positioning|accessibility|provides the following|conveniently located|value proposition|ordering channels)\b/i.test(
      n
    )
  ) {
    return true;
  }
  if (/[:：]\s*$/.test(n)) return true;
  if (
    /^(basic overview|key points|location|physical store|operating hours|services offered|pricing|ordering|website|phone|social media|online presence|value proposition|about us|contact|hours)$/i.test(
      n.replace(/&/g, 'and').replace(/\s+/g, ' ')
    )
  ) {
    return true;
  }
  if (/[.!?]$/.test(n) && (n.length > 40 || (n.match(/\s+/g) || []).length >= 4)) {
    return true;
  }
  if ((n.match(/\s+/g) || []).length >= 12) return true;
  return false;
}

describe('ingest prose service guard', () => {
  it('keeps short catalog names', () => {
    assert.equal(isProseServiceName('Deluxe room'), false);
    assert.equal(isProseServiceName('Conference hall'), false);
  });

  it('rejects document paragraphs and section headers', () => {
    assert.equal(isProseServiceName('1. Business identity'), true);
    assert.equal(
      isProseServiceName(
        'Ngong Hills Hotel is an urban four-star hotel in Nairobi, Kenya.'
      ),
      true
    );
    assert.equal(
      isProseServiceName('Ngong Hills Hotel provides the following main services:'),
      true
    );
  });
});
