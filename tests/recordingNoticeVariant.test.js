// VOICE_RECORDING_NOTICE_VARIANT: greet and ask first, then a short
// reason-led recording notice in the same language (needs VOICE_OPENING_V2).
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const rnv = require('../src/speech/recordingNoticeVariant');
const callOpening = require('../src/speech/callOpening');
const { tenantProfileFromRow } = require('../src/tenantProfile');
const { TENANTS } = require('./fixtures/openingTenants');

const REC = { VOICE_STREAM_RECORD: 'on' };

function withEnv(env, fn) {
  const prev = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] == null) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function opening(tenant, extra = {}) {
  const p = tenantProfileFromRow(TENANTS[tenant]);
  return callOpening.composeOpening({
    businessName: p.businessName,
    spokenName: p.spokenName,
    agentName: p.agentName,
    greetingInvite: p.greetingInvite,
    language: callOpening.shopLanguage(p),
    isOpen: true,
    ...extra,
  });
}

describe('variant flag parsing and per-call pick', () => {
  it('off by default and for off/0/none/garbage', () => {
    for (const v of [undefined, '', 'off', '0', 'none', 'x', 'd']) {
      assert.deepEqual(rnv.noticeVariants({ VOICE_RECORDING_NOTICE_VARIANT: v }), [], String(v));
      assert.equal(rnv.pickNoticeVariant('HD_1', { VOICE_RECORDING_NOTICE_VARIANT: v }), null);
    }
  });

  it('a single letter pins every call; a list or all splits calls', () => {
    assert.equal(rnv.pickNoticeVariant('HD_1', { VOICE_RECORDING_NOTICE_VARIANT: 'b' }), 'b');
    assert.deepEqual(rnv.noticeVariants({ VOICE_RECORDING_NOTICE_VARIANT: 'a, c' }), ['a', 'c']);
    assert.deepEqual(rnv.noticeVariants({ VOICE_RECORDING_NOTICE_VARIANT: 'all' }), ['a', 'b', 'c']);
  });

  it('deterministic per callSid (no randomness), and every listed variant gets calls', () => {
    const env = { VOICE_RECORDING_NOTICE_VARIANT: 'a,b,c' };
    const counts = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 3000; i += 1) {
      const sid = `HD_${(i * 2654435761) >>> 0}`;
      const v = rnv.pickNoticeVariant(sid, env);
      assert.equal(rnv.pickNoticeVariant(sid, env), v, 'same call, same variant');
      counts[v] += 1;
    }
    for (const v of ['a', 'b', 'c']) assert.ok(counts[v] > 800 && counts[v] < 1200, JSON.stringify(counts));
  });
});

describe('wording and placement', () => {
  it('2-3 wordings per language, short and reason-led', () => {
    for (const lang of ['sw', 'en']) {
      const w = rnv.WORDINGS[lang];
      assert.equal(Object.keys(w).length, 3);
      for (const line of Object.values(w)) {
        assert.ok(line.split(/\s+/).length <= 9, line);
        assert.match(line, lang === 'sw' ? /rekodi/ : /record/);
      }
    }
    assert.equal(rnv.WORDINGS.sw.a, 'Na kwa ubora wa huduma, tunarekodi simu.');
  });

  it('greet and ask first, then the notice, same language; replaces the old notice', () =>
    withEnv(REC, () => {
      for (const tenant of ['aris', 'esga', 'jirani']) {
        for (const v of ['a', 'b', 'c']) {
          const o = opening(tenant, { noticeVariant: v });
          const wording = rnv.WORDINGS.sw[v];
          assert.ok(o.text.endsWith(`${o.invite} ${wording}`), o.text);
          assert.doesNotMatch(o.text, /Simu hii inaweza kurekodiwa|This call may be recorded/);
          assert.equal(o.noticeVariant, v);
          const check = callOpening.checkOpeningLine(o.text, {
            shopName: callOpening.shopLabel(tenantProfileFromRow(TENANTS[tenant])),
            staff: TENANTS[tenant].team_directory.map((m) => m.name),
          });
          assert.ok(check.ok, `${tenant}/${v}: ${check.problems}`);
        }
      }
      const en = opening('esga', { language: 'en', greetingInvite: '', noticeVariant: 'a' });
      assert.equal(en.text, 'Esga, this is Lucy. How can I help? And for service quality, we record calls.');
    }));

  it('variant off keeps the PR-A opening exactly', () =>
    withEnv(REC, () => {
      for (const tenant of ['aris', 'esga', 'jirani']) {
        assert.equal(opening(tenant, { noticeVariant: null }).text, opening(tenant).text);
      }
      assert.match(opening('esga').text, /Simu hii inaweza kurekodiwa\. Nikusaidie vipi\?$/);
    }));

  it('no notice for returning callers or while the call is not recorded', () => {
    withEnv(REC, () => {
      const back = opening('esga', { noticeVariant: 'a', isReturning: true });
      assert.equal(back.noticeVariant, null);
      assert.doesNotMatch(back.text, /rekodi/);
    });
    withEnv({ VOICE_STREAM_RECORD: null }, () => {
      const o = opening('esga', { noticeVariant: 'a' });
      assert.equal(o.noticeVariant, null);
      assert.doesNotMatch(o.text, /rekodi/);
    });
  });

  it('warm set carries every configured wording', () =>
    withEnv({ ...REC, VOICE_RECORDING_NOTICE_VARIANT: 'a,b,c' }, () => {
      const p = tenantProfileFromRow(TENANTS.esga);
      const lines = callOpening.openingWarmLines(p, { isOpen: true });
      for (const v of ['a', 'b', 'c']) {
        assert.ok(lines.includes(opening('esga', { noticeVariant: v }).text), v);
      }
    }));
});

describe('early hang-up', () => {
  it('within 5 s of the greeting end, or during it, counts; ours never does', () => {
    assert.deepEqual(rnv.earlyHangup({ greetingEndAt: 1000, closedAt: 5900 }), { early: true, sinceEndMs: 4900 });
    assert.deepEqual(rnv.earlyHangup({ greetingEndAt: 1000, closedAt: 6001 }), { early: false, sinceEndMs: 5001 });
    assert.deepEqual(rnv.earlyHangup({ greetingEndAt: null, closedAt: 500 }), { early: true, sinceEndMs: null });
    assert.equal(rnv.earlyHangup({ greetingEndAt: 1000, closedAt: 2000, byAgent: true }).early, false);
  });
});
