'use strict';
// BRAIN_CALL_CORE (Alvin decision 2): "Text me when a caller asks for a callback or a cancel" — per business,
// Advanced setting, default ON. Stored in the existing tenants.business_policies jsonb (no migration):
//   business_policies.owner_text_callback_cancel: true | false   (missing = true)
// The record (task / cancelled row) is always written; only the owner text is skipped when the owner turned it off.
// Off flag (BRAIN_CALL_CORE != on) = today's behavior: the owner text always goes.
const { coreOn } = require('./callCore');

function ownerTextOn(profile = {}) {
  const v = profile && profile.businessPolicies ? profile.businessPolicies.owner_text_callback_cancel : undefined;
  if (v === undefined || v === null || v === '') return true;
  return !(v === false || /^(false|off|0|no)$/i.test(String(v)));
}
/** kind: 'callback' | 'cancel'. true = skip the owner text (record still written). */
function skipOwnerText({ env = process.env, profile = {}, kind } = {}) {
  if (kind !== 'callback' && kind !== 'cancel') return false;
  return coreOn({ env, tenantId: profile && profile.id }) && !ownerTextOn(profile);
}
module.exports = { ownerTextOn, skipOwnerText };
