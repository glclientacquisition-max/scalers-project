/**
 * Same rule as the payment-retry cron: a bearer token must match the secret.
 * An empty secret refuses every caller.
 * @param {string | null | undefined} header
 * @param {string | null | undefined} secret
 */
function billingCronAllows(header, secret) {
  const value = secret || "";
  if (!value) return false;
  return (header || "") === `Bearer ${value}`;
}

module.exports = { billingCronAllows };
