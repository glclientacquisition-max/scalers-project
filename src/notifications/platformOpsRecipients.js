// Scalers platform ops list (not tenant team_directory). Comma-separated env.

const { uniqueDestinations } = require('../conversation/teamPermissions');

function splitEnvList(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * @returns {{ recipients: import('../conversation/teamPermissions').NotifyMember[], source: string }}
 */
function platformOpsRecipients(env = process.env) {
  const phones = splitEnvList(env.SCALERS_OPS_ALERT_PHONES);
  const emails = splitEnvList(
    env.SCALERS_OPS_ALERT_EMAILS || env.SCALERS_OPS_ALERT_EMAIL || ''
  );
  const people = [];
  for (const phone of phones) {
    people.push({
      name: 'Scalers ops',
      role: '',
      phone,
      email: '',
      receives_escalation: false,
      receives_inbox: false,
      receives_ops: true,
    });
  }
  for (const email of emails) {
    people.push({
      name: 'Scalers ops',
      role: '',
      phone: '',
      email: email.toLowerCase(),
      receives_escalation: false,
      receives_inbox: false,
      receives_ops: true,
    });
  }
  const recipients = uniqueDestinations(people);
  if (recipients.length) {
    return { recipients, source: 'env' };
  }
  return { recipients: [], source: 'none' };
}

module.exports = {
  platformOpsRecipients,
  splitEnvList,
};
