'use strict';
// BRAIN_CALL_CORE (Alvin decision 2): "Text me when a caller asks for a callback or a cancel" — per business,
// Advanced setting, default ON. Stored in the existing tenants.business_policies jsonb (no migration):
//   business_policies.owner_text_callback_cancel: true | false   (missing = true)
// The record (task / cancelled row) is always written; only the owner text is skipped when the owner turned it off.
// B2: BRAIN_CALL_CORE no longer gates this (it was on everywhere the engines ran); the owner's setting always applies.

function ownerTextOn(profile = {}) {
  const v = profile && profile.businessPolicies ? profile.businessPolicies.owner_text_callback_cancel : undefined;
  if (v === undefined || v === null || v === '') return true;
  return !(v === false || /^(false|off|0|no)$/i.test(String(v)));
}
/** kind: 'callback' | 'cancel'. true = skip the owner text (record still written). */
function skipOwnerText({ profile = {}, kind } = {}) {
  if (kind !== 'callback' && kind !== 'cancel') return false;
  return !ownerTextOn(profile);
}
module.exports = { ownerTextOn, skipOwnerText };
