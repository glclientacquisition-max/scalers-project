/**
 * Shared contact-identity vectors. Voice and Desk must agree on every row.
 */

const PHONE_NORMALIZE = [
  { raw: '0712345678', kenya: '+254712345678', stored: '+254712345678' },
  { raw: '254712345678', kenya: '+254712345678', stored: '+254712345678' },
  { raw: '+254712345678', kenya: '+254712345678', stored: '+254712345678' },
  { raw: '0712 345 678', kenya: '+254712345678', stored: '+254712345678' },
  { raw: '712345678', kenya: '+254712345678', stored: '+254712345678' },
  { raw: '+14155552671', kenya: null, stored: '+14155552671' },
  { raw: 'unknown', kenya: null, stored: 'unknown' },
  { raw: '', kenya: null, stored: null },
  { raw: '  ', kenya: null, stored: null },
];

const PHONE_PARSE = [
  { raw: '0712345678', ok: true, phone: '+254712345678' },
  { raw: '254712345678', ok: true, phone: '+254712345678' },
  { raw: '+254712345678', ok: true, phone: '+254712345678' },
  { raw: '0712 345 678', ok: true, phone: '+254712345678' },
  { raw: '+14155552671', ok: true, phone: '+14155552671' },
  { raw: '', ok: false },
  { raw: '   ', ok: false },
  { raw: 'unknown', ok: false },
  { raw: 'Unknown', ok: false },
];

const JUNK_NAMES = [
  'Haijawekwa',
  'Calling',
  'Callings',
  'Theexact',
  'Where',
  'Where are you',
  'customer',
  'unknown',
];

const REAL_NAMES = ['Amina', 'Alvin.', 'Jane'];

const NAME_SAME = [
  { a: 'Isha', b: 'Aisha', same: true },
  { a: 'Ameena', b: 'Amina', same: true },
  { a: 'Asha', b: 'Aisha', same: false },
  { a: 'Jane', b: 'June', same: false },
  { a: 'Colin', b: 'Collins', same: true },
  { a: 'amina', b: 'Amina', same: true },
];

const MERGE_CASES = [
  {
    id: 'first-name',
    existing: null,
    incoming: { name: 'Amina', callId: 'c1', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Amina',
    alts: [],
  },
  {
    id: 'empty-does-not-clobber',
    existing: { name: 'Amina', metadata: {} },
    incoming: { name: '  ' },
    name: 'Amina',
    alts: [],
  },
  {
    id: 'distinct-alternate',
    existing: { name: 'Amina', metadata: {} },
    incoming: { name: 'Brian', callId: 'c2', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Amina',
    alts: ['Brian'],
  },
  {
    id: 'fuzzy-upgrade-isha-aisha',
    existing: { name: 'Isha', metadata: {} },
    incoming: { name: 'Aisha', callId: 'c3', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Aisha',
    alts: [],
  },
  {
    id: 'fuzzy-keep-aisha',
    existing: { name: 'Aisha', metadata: {} },
    incoming: { name: 'Isha', callId: 'c4', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Aisha',
    alts: [],
  },
  {
    id: 'asha-is-not-aisha',
    existing: { name: 'Asha', metadata: {} },
    incoming: { name: 'Aisha', callId: 'c5', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Asha',
    alts: ['Aisha'],
  },
  {
    id: 'colin-collins-no-alt',
    existing: { name: 'Collins', metadata: {} },
    incoming: { name: 'Colin', callId: 'c6', seenAt: '2026-09-09T00:00:00.000Z' },
    name: 'Collins',
    alts: [],
  },
  {
    id: 'junk-incoming-null',
    existing: null,
    incoming: { name: 'Haijawekwa' },
    name: null,
    alts: [],
  },
  {
    id: 'heal-calling-primary',
    existing: { name: 'Calling', metadata: {} },
    incoming: { name: 'Amina' },
    name: 'Amina',
    alts: [],
  },
  {
    id: 'skip-junk-alternate',
    existing: { name: 'Amina', metadata: {} },
    incoming: { name: 'Callings' },
    name: 'Amina',
    alts: [],
  },
];

const ALT_CAP_NAMES = ['B', 'C', 'D', 'E', 'F', 'G'];

module.exports = {
  ALT_CAP_NAMES,
  JUNK_NAMES,
  MERGE_CASES,
  NAME_SAME,
  PHONE_NORMALIZE,
  PHONE_PARSE,
  REAL_NAMES,
};
