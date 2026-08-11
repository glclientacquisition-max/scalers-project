const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SECTION_HEADING_RE =
  /^(basic overview|key points|location(?:\s*&\s*physical store)?|physical store|operating hours|services offered|pricing(?:\s*&\s*ordering)?|ordering(?:\s*channels)?|website|phone(?:\s*&\s*social media)?|social media|online presence(?:\s*&\s*social media)?|value proposition|about us|contact|hours)$/i;

function isProseServiceName(name) {
  const n = String(name || '').trim();
  if (!n) return true;
  if (n.length > 80) return true;
  if (/^\d+[\.)]\s/.test(n)) return true;
  if (/[:：]\s*$/.test(n)) return true;
  const normalized = n.replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
  if (SECTION_HEADING_RE.test(normalized)) {
    return true;
  }
  if (
    n.length <= 48 &&
    /^(Basic Overview|Key Points|Operating Hours|Services Offered|Pricing|Ordering|Value Proposition|Online Presence)/i.test(
      n
    )
  ) {
    return true;
  }
  if (
    /\b(business identity|service philosophy|positioning|accessibility|provides the following|conveniently located|value proposition|ordering channels)\b/i.test(
      n
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

describe('business brief ingest mapping', () => {
  it('rejects ChapterOne-style section headings as services', () => {
    for (const heading of [
      'Basic Overview',
      'Operating Hours',
      'Services Offered',
      'Pricing & Ordering',
      'Ordering channels:',
      'Value Proposition',
      'Online Presence & Social Media',
    ]) {
      assert.equal(isProseServiceName(heading), true, heading);
    }
  });

  it('keeps real bookstore offerings', () => {
    assert.equal(isProseServiceName('Book sales (in-store & online)'), false);
    assert.equal(isProseServiceName('Book sourcing / special orders'), false);
    assert.equal(isProseServiceName('Same-day Nairobi delivery'), false);
  });

  it('extractLocally maps a ChapterOne overview to retail structure', () => {
    const script = `
import { extractLocally } from ${JSON.stringify(
      path.join(__dirname, '../dashboard/src/lib/ingest/extract.ts')
    )};
const text = \`ChapterOne Bookstore in Nairobi.
Store name: Chapter One Bookstore
Address: Miundi Mbingu Street, opposite City Market Fashion Mall, Shop No. M4, Nairobi CBD.
Monday – Saturday: 9:00 AM – 7:00 PM
Sunday: Closed
Book Sourcing / Special Orders and same-day delivery in Nairobi.
Countrywide shipping. free quotation. prices vary by title.
Phone: 0740 442 943
Instagram: @bookstorechapterone
Ability to source almost any book.\`;
const d = extractLocally(text, 'pasted text');
if (d.vertical !== 'retail') throw new Error('vertical '+d.vertical);
if (!d.services.some(s => /sourcing/i.test(s.name))) throw new Error('missing sourcing');
if (d.services.some(s => /monday|overview|hours/i.test(s.name))) throw new Error('junk service '+d.services.map(s=>s.name));
if (!d.hoursSchedule || !d.hoursSchedule.days.mon || d.hoursSchedule.days.sun !== null) throw new Error('hours');
if (!d.locations?.[0]?.address?.includes('Miundi')) throw new Error('location');
if (!d.contactPhone?.includes('0740')) throw new Error('phone');
if (d.faqs.length < 4) throw new Error('faqs '+d.faqs.length);
console.log('ok');
`;
    const result = spawnSync(
      'npx',
      ['--yes', 'tsx', '-e', script],
      {
        cwd: path.join(__dirname, '../dashboard'),
        encoding: 'utf8',
        env: { ...process.env },
      }
    );
    if (result.status !== 0) {
      assert.fail(
        `extractLocally smoke failed:\n${result.stderr || result.stdout}`
      );
    }
    assert.match(result.stdout, /ok/);
  });
});
