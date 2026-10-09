const { describe, it, beforeEach } = require('node:test');
const assert = require('assert');
const {
  notePlatformOpsDegrade,
  notePlatformOpsRecovered,
  buildPlatformOpsBody,
  resetPlatformOpsAlert,
  setPlatformOpsDispatch,
  ledgerKind,
} = require('../src/notifications/platformOpsAlert');
const { resetSonioxProviderHealth, noteSonioxProviderError } = require('../src/speech/sonioxProviderHealth');
const { classifySonioxError } = require('../src/speech/sonioxErrors');

describe('platformOpsAlert', () => {
  beforeEach(() => {
    resetPlatformOpsAlert();
    resetSonioxProviderHealth();
    delete process.env.SCALERS_OPS_ALERT_PHONES;
    delete process.env.SCALERS_OPS_ALERT_EMAILS;
    delete process.env.VOICE_PLATFORM_OPS_DRY_RUN;
  });

  it('builds ops copy without vendor brands', () => {
    const body = buildPlatformOpsBody('speech', { channel: 'tts', message: '402 exhausted' });
    assert.match(body, /platform Speech is degraded/);
    assert.doesNotMatch(body, /soniox/i);
    assert.doesNotMatch(body, /[—–]/);
  });

  it('alerts each kind once until recovery', async () => {
    const sent = [];
    setPlatformOpsDispatch(async (opts) => {
      sent.push(opts);
      return { sent: [{ channel: 'email', to: 'ops@scalers.co.ke' }], errors: [] };
    });
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';

    const first = await notePlatformOpsDegrade('speech');
    const second = await notePlatformOpsDegrade('speech');
    const reasoning = await notePlatformOpsDegrade('reasoning');

    assert.equal(first.ok, true);
    assert.equal(second.reason, 'already_degraded');
    assert.equal(reasoning.ok, true);
    assert.equal(sent.length, 2);
    assert.equal(ledgerKind('speech'), 'platform_ops_speech');
  });

  it('dry-run logs without dispatch', async () => {
    process.env.VOICE_PLATFORM_OPS_DRY_RUN = 'true';
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    let called = false;
    setPlatformOpsDispatch(async () => {
      called = true;
      return { sent: [], errors: [] };
    });
    const result = await notePlatformOpsDegrade('telephony');
    assert.equal(result.ok, true);
    assert.equal(result.channel, 'dry_run');
    assert.equal(called, false);
  });

  it('dispatches email only and ignores ops phones', async () => {
    const sent = [];
    setPlatformOpsDispatch(async (opts) => {
      sent.push(opts);
      return { sent: [{ channel: 'email', to: 'ops@scalers.co.ke' }], errors: [] };
    });
    process.env.SCALERS_OPS_ALERT_PHONES = '+254700000099';
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    await notePlatformOpsDegrade('telephony');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].channels, { sms: false, whatsapp: false, email: true });
    assert.deepEqual(
      sent[0].recipients.map((r) => [r.phone, r.email]),
      [['', 'ops@scalers.co.ke']]
    );
  });

  it('phones alone are not an ops list', async () => {
    let called = false;
    setPlatformOpsDispatch(async () => {
      called = true;
      return { sent: [], errors: [] };
    });
    process.env.SCALERS_OPS_ALERT_PHONES = '+254700000099';
    const result = await notePlatformOpsDegrade('speech');
    assert.equal(result.reason, 'no_ops_recipients');
    assert.equal(called, false);
  });

  it('recovery allows a later alert', async () => {
    setPlatformOpsDispatch(async () => ({
      sent: [{ channel: 'email', to: 'ops@scalers.co.ke' }],
      errors: [],
    }));
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    await notePlatformOpsDegrade('telephony');
    notePlatformOpsRecovered('telephony');
    const again = await notePlatformOpsDegrade('telephony');
    assert.equal(again.ok, true);
  });
});

describe('sonioxProviderHealth platform hook', () => {
  beforeEach(() => {
    resetPlatformOpsAlert();
    resetSonioxProviderHealth();
    process.env.SCALERS_OPS_ALERT_EMAILS = 'ops@scalers.co.ke';
    setPlatformOpsDispatch(async () => ({
      sent: [{ channel: 'email' }],
      errors: [],
    }));
  });

  it('fires platform speech alert on first billing error', async () => {
    const err = { status: 402, message: 'Organization balance exhausted' };
    noteSonioxProviderError('tts', classifySonioxError(err));
    await new Promise((r) => setTimeout(r, 20));
    const dup = await notePlatformOpsDegrade('speech');
    assert.equal(dup.reason, 'already_degraded');
  });
});
