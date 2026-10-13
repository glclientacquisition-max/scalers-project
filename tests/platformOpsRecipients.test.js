const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('assert');
const {
  platformOpsRecipients,
  emailsFromSettingsRow,
  setPlatformOpsRecipientsLoader,
  resetPlatformOpsRecipientsCache,
} = require('../src/notifications/platformOpsRecipients');

function rowLoader(row, counter) {
  return async () => {
    if (counter) counter.n += 1;
    return { data: row, error: null };
  };
}

describe('platformOpsRecipients (Admin first, email only)', () => {
  const env = {};
  beforeEach(() => {
    for (const k of Object.keys(env)) delete env[k];
    resetPlatformOpsRecipientsCache();
  });
  afterEach(() => setPlatformOpsRecipientsLoader(null));

  it('reads people[].email from platform_ops_settings and ignores phones', async () => {
    setPlatformOpsRecipientsLoader(
      rowLoader({
        emails: ['old@scalers.co.ke'],
        people: [
          { id: 'a', name: 'Alvin', phone: '+254700000001', email: 'Alvin@Scalers.co.ke ' },
          { id: 'b', name: 'Phone only', phone: '+254700000002', email: '' },
          { id: 'c', name: 'Dup', phone: '', email: 'alvin@scalers.co.ke' },
        ],
      })
    );
    env.SCALERS_OPS_ALERT_EMAILS = 'env@scalers.co.ke';
    env.SCALERS_OPS_ALERT_PHONES = '+254700000099';
    const out = await platformOpsRecipients({ env });
    assert.equal(out.source, 'admin');
    assert.deepEqual(out.emails, ['alvin@scalers.co.ke']);
    assert.equal(out.recipients.length, 1);
    assert.equal(out.recipients[0].phone, '');
    assert.equal(out.recipients[0].email, 'alvin@scalers.co.ke');
  });

  it('falls back to emails[] when people has no email', () => {
    assert.deepEqual(
      emailsFromSettingsRow({ emails: ['ops@scalers.co.ke', 'bad'], people: [] }),
      ['ops@scalers.co.ke']
    );
  });

  it('falls back to SCALERS_OPS_ALERT_EMAILS when the Admin list is empty', async () => {
    setPlatformOpsRecipientsLoader(rowLoader({ emails: [], people: [] }));
    env.SCALERS_OPS_ALERT_EMAILS = 'env@scalers.co.ke, env2@scalers.co.ke';
    const out = await platformOpsRecipients({ env });
    assert.equal(out.source, 'env');
    assert.deepEqual(out.emails, ['env@scalers.co.ke', 'env2@scalers.co.ke']);
  });

  it('falls back to env when the table is missing or the query fails', async () => {
    setPlatformOpsRecipientsLoader(async () => ({
      data: null,
      error: { message: 'relation "public.platform_ops_settings" does not exist' },
    }));
    env.SCALERS_OPS_ALERT_EMAILS = 'env@scalers.co.ke';
    const missing = await platformOpsRecipients({ env });
    assert.equal(missing.source, 'env');
    assert.match(missing.adminError, /does not exist/);

    setPlatformOpsRecipientsLoader(async () => {
      throw new Error('network down');
    });
    const thrown = await platformOpsRecipients({ env });
    assert.equal(thrown.source, 'env');
    assert.deepEqual(thrown.emails, ['env@scalers.co.ke']);
  });

  it('returns none (and never phones) when nothing is set', async () => {
    setPlatformOpsRecipientsLoader(rowLoader(null));
    env.SCALERS_OPS_ALERT_PHONES = '+254700000099';
    const out = await platformOpsRecipients({ env });
    assert.equal(out.source, 'none');
    assert.equal(out.recipients.length, 0);
  });

  it('caches for a few minutes, then re-reads', async () => {
    const counter = { n: 0 };
    setPlatformOpsRecipientsLoader(rowLoader({ people: [{ email: 'a@scalers.co.ke' }] }, counter));
    await platformOpsRecipients({ env, now: 1_000 });
    await platformOpsRecipients({ env, now: 1_000 + 60_000 });
    assert.equal(counter.n, 1);
    await platformOpsRecipients({ env, now: 1_000 + 4 * 60_000 });
    assert.equal(counter.n, 2);
    await platformOpsRecipients({ env, now: 1_000 + 4 * 60_000, force: true });
    assert.equal(counter.n, 3);
  });
});
