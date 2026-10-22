/** Canonical payments object for fact hash (no provenance envelope). Voice-side twin of dashboard paymentsFactHashValue. */

function obj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function paymentsFactHashValue(raw) {
  const r = obj(raw);
  if (!r) return null;
  const methods = Array.isArray(r.methods) ? [...new Set(r.methods.map(String).filter(Boolean))] : [];
  if (!methods.length) return null;
  return {
    version: 2,
    methods,
    mpesa_till: r.mpesa_till ?? null,
    mpesa_paybill: r.mpesa_paybill ?? null,
    pochi: r.pochi ?? null,
    mpesa_send: r.mpesa_send ?? null,
    airtel: r.airtel ?? null,
    bank: r.bank ?? null,
    card: r.card ?? null,
    timings: Array.isArray(r.timings) ? r.timings.map(String) : [],
    deposit_percent: r.deposit_percent ?? null,
    note: r.note ?? null,
  };
}

module.exports = { paymentsFactHashValue };
