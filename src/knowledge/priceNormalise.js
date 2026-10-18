'use strict';
// Stand-in for the shared fact-module normaliser.
// normalisePrice(item) -> { kind: 'fixed'|'from'|'range'|'quote'|'unknown', min, max }
// Lookup calls factSheet.normalisePrice when that export exists, and this
// function only until that pull request is on main. Do not parse prices in
// the lookup itself.

const KINDS = new Set(['fixed', 'from', 'range', 'quote', 'unknown']);

function num(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function blank(kind) {
  return { kind, min: null, max: null };
}

function fromColumns(row) {
  const kind = String(row.price_kind || row.priceKind || '').trim().toLowerCase();
  if (!KINDS.has(kind)) return null;
  if (kind === 'quote' || kind === 'unknown') return blank(kind);
  const min = num(row.price_min != null ? row.price_min : row.priceMin);
  const max = num(row.price_max != null ? row.price_max : row.priceMax);
  if (kind === 'fixed' && min != null) return { kind, min, max: min };
  if (kind === 'from' && min != null) return { kind, min, max };
  if (kind === 'range' && min != null && max != null) return { kind, min, max };
  return blank('unknown');
}

function fromLegacy(raw) {
  const text = String(raw || '').trim();
  if (!text) return blank('unknown');
  if (/^(ask|poa|quote|tbd|n\/a|na|upon request)$/i.test(text)) return blank('unknown');
  if (/\b(ask|quote|upon request|call for price)\b/i.test(text) && !/\d/.test(text)) return blank('unknown');
  const nums = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return blank('unknown');
  if (nums.length >= 2) return { kind: 'range', min: nums[0], max: nums[1] };
  if (/^(from|starting at|starting from)\b/i.test(text)) return { kind: 'from', min: nums[0], max: null };
  return { kind: 'fixed', min: nums[0], max: nums[0] };
}

function normalisePrice(item) {
  const row = item && typeof item === 'object' ? item : { price: item };
  return fromColumns(row) || fromLegacy(row.price || row.price_range || row.priceRange || '');
}

module.exports = { normalisePrice };
