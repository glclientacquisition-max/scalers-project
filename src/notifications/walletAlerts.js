// Automatic prepaid low/empty wallet alerts to the business owner.
// Soft = live WhatsApp/email only. Never blocks calls by itself.

const { dispatchToStaff, staffRecipients } = require('./recipients');
const { walletEmptyBody, walletLowBody } = require('./templates');

function buildLowBalanceBody(opts) {
  return walletLowBody(opts);
}

function buildEmptyBalanceBody(opts) {
  return walletEmptyBody(opts);
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

  const { data: tenantRow } = await supabase
    .from('tenants')
    .select('team_directory, notify_channels')
    .eq('id', tenantId)
    .maybeSingle();

  const results = [];
  const ownerPhone = row.whatsapp_notification_number || null;
  const ownerEmail = row.alert_email || null;
  const businessName = row.business_name || null;
  const ops = staffRecipients('ops', {
    teamDirectory: tenantRow?.team_directory,
    ownerPhone,
    ownerEmail,
  });
  const channels = tenantRow?.notify_channels || null;

  if (row.should_alert_empty) {
    const body = buildEmptyBalanceBody({
      businessName,
      onDemandEnabled: Boolean(row.on_demand_usage_enabled),
    });
    const { sent } = await dispatchToStaff({
      recipients: ops.recipients,
      body,
      subject: `Scalers prepaid empty${businessName ? `. ${businessName}` : ''}`,
      lead: { businessName, reason: 'Prepaid wallet empty' },
      channels,
    });
    results.push({ kind: 'empty', ...(sent[0] || { channel: null }) });
  } else if (row.should_alert_low) {
    const body = buildLowBalanceBody({
      businessName,
      balanceKes: row.wallet_balance_kes,
      lowThresholdKes: row.low_threshold_kes,
    });
    const { sent } = await dispatchToStaff({
      recipients: ops.recipients,
      body,
      subject: `Scalers wallet running low${businessName ? `. ${businessName}` : ''}`,
      lead: { businessName, reason: 'Prepaid wallet low' },
      channels,
    });
    results.push({ kind: 'low', ...(sent[0] || { channel: null }) });
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
