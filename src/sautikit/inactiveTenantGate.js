'use strict';

// Inbound gate for a business that is archived or suspended.
//
// A tenant row with is_active = false, or archived (archived_at set, Super
// Admin Archive, #636), still owns its DID row until the number is released.
// resolveTenantId matched that DID by exact number and the call was answered:
// Stream opened, the model and speech ran, minutes were metered, and a
// dead tenant's setup could look like an outage. The call must not be taken.
//
// At POST /voice/incoming, before Stream and before the call row: if every
// tenant row that owns the dialled number is inactive or archived, return a
// short "line unavailable" message and hang up. No /ws/media, no call row,
// no minutes, no outage alert. Any lookup error fails open (the gate never
// blocks a live business because the database blinked).
//
// The message: <Play> of the en and sw clips when allow-listed CDN URLs are
// configured (VOICE_LINE_UNAVAILABLE_CLIP_URL_EN / _SW), else <Say> with the
// same short copy. Generic copy: no business or agent name.

const LINE_UNAVAILABLE_EN = 'Sorry, this line is not available right now. Goodbye.';
const LINE_UNAVAILABLE_SW = 'Samahani, laini hii haipatikani kwa sasa. Kwaheri.';

function digitsOf(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Kenyan numbers compare on their last nine digits (+254 / 254 / 0 forms). */
function sameNumber(a, b) {
  const x = digitsOf(a);
  const y = digitsOf(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 9 && y.length >= 9 && x.slice(-9) === y.slice(-9);
}

function rowArchived(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.archived === true) return true;
  return Boolean(row.archived_at);
}

function rowLive(row) {
  return Boolean(row) && row.is_active !== false && !rowArchived(row);
}

/**
 * Decide from the tenant rows that own the dialled number.
 * @param {Array<{ id: string, is_active?: boolean, archived_at?: string|null }>} rows
 * @returns {{ closed: boolean, reason: 'no_tenant'|'live'|'archived'|'inactive', tenantId: string|null }}
 */
function tenantLineState(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id);
  if (!list.length) return { closed: false, reason: 'no_tenant', tenantId: null };
  const live = list.find(rowLive);
  if (live) return { closed: false, reason: 'live', tenantId: live.id };
  const archived = list.find(rowArchived);
  const row = archived || list[0];
  return { closed: true, reason: archived ? 'archived' : 'inactive', tenantId: row.id };
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clipUrl(value) {
  const url = String(value || '').trim();
  return /^https:\/\/[^\s<>"]+$/i.test(url) ? url : '';
}

/**
 * The XML for a closed line: the en then sw message, then hang up.
 * @param {{ env?: object }} [opts]
 */
function lineUnavailableXml({ env = process.env } = {}) {
  const en = clipUrl(env.VOICE_LINE_UNAVAILABLE_CLIP_URL_EN);
  const sw = clipUrl(env.VOICE_LINE_UNAVAILABLE_CLIP_URL_SW);
  const parts = [
    en ? `<Play>${escapeXml(en)}</Play>` : `<Say language="en-US">${escapeXml(LINE_UNAVAILABLE_EN)}</Say>`,
    sw ? `<Play>${escapeXml(sw)}</Play>` : `<Say language="sw-KE">${escapeXml(LINE_UNAVAILABLE_SW)}</Say>`,
    '<Hangup/>',
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${parts.join('')}</Response>`;
}

module.exports = {
  LINE_UNAVAILABLE_EN,
  LINE_UNAVAILABLE_SW,
  sameNumber,
  tenantLineState,
  lineUnavailableXml,
};
