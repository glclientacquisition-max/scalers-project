'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveBusinessType } = require('../src/conversation/businessType');
const { entryForRaw, pinSpokenCatalogue } = require('../src/knowledge/spokenCatalogue');
const { parseNotifyChannels } = require('../src/notifications/notifyChannels');
const { beginInstanceSend } = require('../src/notifications/sendLedger');
const { buildBrainCapabilities } = require('../src/conversation/brainPolicy');
const {
  ARIS_E164,
  applyDemoCapabilities,
  assertPayloadSafe,
  assertRemovable,
  assertSeedTarget,
  demoBookingSink,
  demoWriteBlocked,
  isDemoTenant,
  listDemoTenants,
  quoteDemoBilling,
  resolveDemoTenant,
  seedRows,
} = require('../src/demo/tenants');

const STAGING_URL = 'https://sgcdncjxauhsbunobmob.supabase.co';
const PROD_URL = 'https://fjxcdccgyhnvnnlnovcl.supabase.co';

describe('demo tenant resolver', () => {
  it('maps the three public keys to Home services, Shop and Other business', () => {
    const expected = {
      home: 'home_services',
      shop: 'retail',
      other: 'general',
    };
    const labels = {
      home_services: 'Home services',
      retail: 'Shop',
      general: 'Other business',
    };
    for (const item of listDemoTenants()) {
      assert.equal(item.businessType, expected[item.publicKey]);
      assert.equal(item.label, labels[item.businessType]);
      assert.equal(
        resolveBusinessType({
          business_type: item.row.business_type,
          vertical: item.row.vertical,
        }),
        expected[item.publicKey]
      );
    }
    assert.equal(resolveDemoTenant('demo_home').slug, 'demo_home');
    assert.equal(resolveDemoTenant('demo_shop').publicKey, 'shop');
    assert.equal(resolveDemoTenant('demo_other').id, '11111111-1111-4111-8111-111111111103');
  });

  it('rejects any other tenant, including the Aris line', () => {
    assert.equal(isDemoTenant('not-a-demo'), false);
    assert.equal(isDemoTenant(ARIS_E164), false);
    assert.equal(isDemoTenant({ id: 'df4ad9d8-0000-4000-8000-000000000001' }), false);
    assert.equal(isDemoTenant({ sautikit_virtual_number: ARIS_E164 }), false);
    assert.equal(resolveDemoTenant('aris'), null);
  });

  it('keeps bookings, notifications and billing off on the seed rows', () => {
    const rows = assertPayloadSafe(seedRows());
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.billing_enforcement, 'off');
      assert.equal(row.on_demand_usage_enabled, false);
      assert.equal(row.escalation_enabled, false);
      assert.equal(row.business_policies.bookings, false);
      assert.equal(row.business_policies.notifications, false);
      assert.equal(row.business_policies.billing, false);
      assert.equal(row.notify_channels.sms, false);
      assert.equal(row.notify_channels.whatsapp, false);
      assert.equal(row.notify_channels.email, false);
      assert.equal(row.agent_tools.escalate, false);
      assert.equal(row.alert_email, null);
      assert.match(row.sautikit_virtual_number, /^pending:demo_/);
      assert.doesNotMatch(JSON.stringify(row), /\+254/);
    }
  });
});

describe('demo shop prices', () => {
  it('reads the 20W charger price from the catalogue, not a model guess', () => {
    const shop = resolveDemoTenant('shop');
    assert.equal(shop.row.product_catalog.length, 15);
    const pin = pinSpokenCatalogue(shop.profile);
    const entry = entryForRaw(pin.doc, '20W phone charger');
    assert.ok(entry, 'catalogue entry missing');
    assert.ok(entry.price.numbers.includes(890));
    assert.match(entry.price.en, /890/);
    assert.equal(entry.raw.price, 'KSh 890');
  });
});

describe('demo side effects', () => {
  it('does not send when the notify parser would turn SMS back on', async () => {
    const home = resolveDemoTenant('home').row;
    assert.equal(parseNotifyChannels(home.notify_channels).sms, true);
    const gate = await beginInstanceSend(
      { tenantId: home.id, kind: 'lead', callSid: 'demo_test' },
      ['+254700000099']
    );
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'demo_tenant');
    assert.equal(gate.channel, undefined);
  });

  it('blocks booking writes and brain booking tools', () => {
    const home = resolveDemoTenant('demo_home');
    assert.equal(demoWriteBlocked({ tenantId: home.id }), true);
    assert.equal(demoWriteBlocked({ callSid: 'demo_abc' }), true);
    assert.equal(demoWriteBlocked({ tenantId: 'someone-else', callSid: 'HD_real' }), false);
    const sink = demoBookingSink('appointment', { tenantId: home.id });
    assert.equal(sink.sink, 'demo');
    assert.equal(sink.external, false);
    assert.equal(sink.notified, false);
    assert.equal(sink.id, null);
    const caps = applyDemoCapabilities(
      buildBrainCapabilities(home.profile, {
        createAppointment: true,
        createServiceRequest: true,
        liveTransfer: true,
      }),
      home.profile
    );
    assert.equal(caps.createAppointment, false);
    assert.equal(caps.updateAppointment, false);
    assert.equal(caps.createServiceRequest, false);
    assert.equal(caps.notifyCallback, false);
    assert.equal(caps.escalate, false);
    assert.equal(caps.liveTransfer, false);
    assert.equal(caps.answerFromKnowledge, true);
  });

  it('quotes a demo call at zero debit even if enforcement is passed as hard', () => {
    const quote = quoteDemoBilling('demo_shop', {
      usedSeconds: 0,
      includedMinutes: 0,
      deltaSeconds: 180,
      enforcement: 'hard',
      onDemand: true,
      kesPerSecond: 2,
    });
    assert.equal(quote.charge, false);
    assert.equal(quote.debitKes, 0);
    assert.equal(quote.reason, 'demo');
    assert.equal(quoteDemoBilling(ARIS_E164, { enforcement: 'hard', onDemand: true }), null);
  });
});

describe('demo seed gate', () => {
  it('runs only for the exact staging environment and staging project', () => {
    assert.equal(assertSeedTarget({ railwayEnvironment: 'staging', supabaseUrl: STAGING_URL }).ok, true);
    assert.equal(assertSeedTarget({ railwayEnvironment: 'Staging', supabaseUrl: STAGING_URL }).ok, false);
    assert.equal(assertSeedTarget({ railwayEnvironment: 'production', supabaseUrl: STAGING_URL }).ok, false);
    assert.equal(assertSeedTarget({ railwayEnvironment: 'on', supabaseUrl: STAGING_URL }).ok, false);
    assert.equal(assertSeedTarget({ railwayEnvironment: '', supabaseUrl: STAGING_URL }).ok, false);
    assert.equal(assertSeedTarget({ railwayEnvironment: 'staging', supabaseUrl: PROD_URL }).ok, false);
    assert.equal(assertSeedTarget({ railwayEnvironment: 'staging', supabaseUrl: '' }).ok, false);
  });

  it('will not remove a row that is not still a demo placeholder', () => {
    const row = resolveDemoTenant('shop').row;
    assert.equal(assertRemovable(row).ok, true);
    assert.equal(assertRemovable({ id: row.id, sautikit_virtual_number: ARIS_E164 }).ok, false);
    assert.equal(
      assertRemovable({ id: row.id, sautikit_virtual_number: '+254709221537' }).reason,
      'not_placeholder'
    );
    assert.equal(
      assertRemovable({
        id: '22222222-2222-4222-8222-222222222222',
        sautikit_virtual_number: 'pending:demo_shop',
      }).ok,
      false
    );
  });
});
