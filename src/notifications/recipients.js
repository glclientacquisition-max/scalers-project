// Resolve who a staff message may go to. Permissions live on team_directory.

const {
  staffRecipients,
  uniqueDestinations,
} = require('../conversation/teamPermissions');
const { dispatchAlert } = require('./dispatch');

async function dispatchToStaff({
  recipients,
  body,
  lead,
  subject,
  channels,
  ledger,
} = {}) {
  const people = uniqueDestinations(recipients || []);
  const sent = [];
  const errors = [];
  for (const person of people) {
    try {
      const result = await dispatchAlert({
        to: person.phone,
        email: person.email,
        body,
        lead,
        subject,
        channels,
        ledger,
      });
      if (result?.channel) {
        sent.push({
          ...result,
          role: 'staff',
          name: person.name || null,
        });
      } else if (result?.reason) {
        errors.push(`${person.name || 'staff'}:${result.reason}`);
      }
    } catch (err) {
      errors.push(`${person.name || 'staff'}:${err?.message || err}`);
      console.warn(
        `[notify] staff send failed (${person.name || 'staff'}):`,
        err?.message || err
      );
    }
  }
  return { sent, errors };
}

module.exports = {
  staffRecipients,
  dispatchToStaff,
};
