const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeKenyaE164 } = require('../src/conversation/liveTransferReady');

function normalizeStoredPhone(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  return normalizeKenyaE164(trimmed) || trimmed;
}

describe('caller phone normalize before DB write', () => {
  it('maps Kenya variants to one E.164 key', () => {
    const expected = '+254712345678';
    assert.equal(normalizeStoredPhone('0712345678'), expected);
    assert.equal(normalizeStoredPhone('254712345678'), expected);
    assert.equal(normalizeStoredPhone('+254712345678'), expected);
    assert.equal(normalizeStoredPhone('0712 345 678'), expected);
  });

  it('leaves undialable values trimmed instead of dropping them', () => {
    assert.equal(normalizeStoredPhone('unknown'), 'unknown');
    assert.equal(normalizeStoredPhone(''), null);
  });

  it('applies normalizeStoredPhone in upsertCall and upsertContact', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
    assert.match(src, /normalizeKenyaE164/);
    assert.match(src, /function normalizeStoredPhone/);
    assert.match(
      src,
      /caller_number:\s*\n\s*normalizeStoredPhone\(fromNumber\)/
    );
    assert.match(src, /const phoneNorm = normalizeStoredPhone\(phone\);/);
  });
});
