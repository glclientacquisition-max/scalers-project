// Automatic prepaid low/empty wallet alerts to the business owner.
// Soft = live WhatsApp/email only. Never blocks calls by itself.

const { dispatchAlert } = require('./dispatch');

function buildLowBalanceBody({ businessName, balanceKes, lowThresholdKes }) {
  const bal = Number(balanceKes || 0).toLocaleString('en-KE');
  const thr = Number(lowThresholdKes || 200).toLocaleString('en-KE');
  return [
    `Scalers wallet running low${businessName ? ` — ${businessName}` : ''}`,
    `Prepaid balance is about KES ${bal} (alert under KES ${thr}).`,
    `Top up soon so calls keep being covered. On-demand usage is separate — enable it on Wallet if you want to continue after prepaid hits zero.`,
  ].join('\n');
}

function buildEmptyBalanceBody({ businessName, onDemandEnabled }) {
  const name = businessName ? ` — ${businessName}` : '';
  if (onDemandEnabled) {
    return [
      `Scalers prepaid empty${name}`,
      `Your prepaid balance is KES 0 or below.`,
      `On-demand usage is ON, so calls can keep going and will bill beyond prepaid. Top up when you can.`,
    ].join('\n');
  }
  return [
    `Scalers prepaid empty${name}`,
    `Your prepaid balance is KES 0 or below.`,
    `On-demand usage is OFF, so further call charges are paused until you top up or enable on-demand on the Wallet page.`,
  ].join('\n');
}

/**
 * Claim + send at most one low and one empty alert until balance recovers.
 * Safe no-op when RPC missing or tenant is on beta.
 */
async function maybeNotifyWalletBalanceAlerts(supabase, { tenantId } = {}) {
  if (!supabase || !tenantId) return null;

  const { data, error } = await supabase.rpc('claim_wallet_balance_alerts', {
    p_tenant_id: tenantId,
  });

  if (error) {
    if (/function|does not exist|schema cache/i.test(error.message || '')) {
      return null;
    }
    throw error;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;

  const results = [];
  const to = row.whatsapp_notification_number || null;
  const email = row.alert_email || null;
  const businessName = row.business_name || null;

  if (row.should_alert_empty) {
    const body = buildEmptyBalanceBody({
      businessName,
      onDemandEnabled: Boolean(row.on_demand_usage_enabled),
    });
    const sent = await dispatchAlert({
      to,
      email,
      body,
      subject: `Scalers prepaid empty${businessName ? ` — ${businessName}` : ''}`,
      lead: { businessName, reason: 'Prepaid wallet empty' },
    });
    results.push({ kind: 'empty', ...sent });
  } else if (row.should_alert_low) {
    const body = buildLowBalanceBody({
      businessName,
      balanceKes: row.wallet_balance_kes,
      lowThresholdKes: row.low_threshold_kes,
    });
    const sent = await dispatchAlert({
      to,
      email,
      body,
      subject: `Scalers wallet running low${businessName ? ` — ${businessName}` : ''}`,
      lead: { businessName, reason: 'Prepaid wallet low' },
    });
    results.push({ kind: 'low', ...sent });
  }

  return {
    balance: row.wallet_balance_kes,
    alerts: results,
  };
}

module.exports = {
  maybeNotifyWalletBalanceAlerts,
  buildLowBalanceBody,
  buildEmptyBalanceBody,
};
