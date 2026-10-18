'use strict';

// VOICE_TRANSCRIPT_ORDER: greeting keeps its slot; transcripts.seq with a
// missing-column fallback. Fake Supabase client: no network.

const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  createCallTranscript,
  speakWithTranscriptSlot,
  transcriptOrderEnabled,
} = require('../src/speech/voiceTiming');

const GREETING =
  'Good evening, Done and Dusted, this is Shy. You can speak in English or Kiswahili. Tukusaidie vipi.';

/**
 * HD_f9b67efaf590 (staging, 15 Oct 23:57 EAT): the caller spoke and got
 * answers while the long cache-miss greeting was still playing.
 */
async function replayCallerOverGreeting({ enabled, result = { ok: true }, throws = null }) {
  const t = createCallTranscript();
  const run = async () => {
    t.pushCaller('Niulize?');
    t.pushAgent('Je, naongea na Alvin?');
    t.pushCaller('Niulize, ni services gani mna offer?');
    t.pushAgent('Tunafanya usafi wa magodoro, sofa, mazulia.');
    await new Promise((r) => setImmediate(r));
    if (throws) throw throws;
    return result;
  };
  let error = null;
  try {
    await speakWithTranscriptSlot({
      transcript: t,
      line: GREETING,
      enabled,
      run,
      keep: (r) => Boolean(r?.ok) && !r?.outage,
    });
  } catch (err) {
    error = err;
  }
  t.pushCaller('Karibu.');
  return { turns: t.turns(), error };
}

describe('transcriptOrderEnabled', () => {
  it('is off by default and on for 1/true/on/yes', () => {
    assert.equal(transcriptOrderEnabled({}), false);
    assert.equal(transcriptOrderEnabled({ VOICE_TRANSCRIPT_ORDER: '' }), false);
    assert.equal(transcriptOrderEnabled({ VOICE_TRANSCRIPT_ORDER: 'off' }), false);
    for (const v of ['1', 'true', 'on', 'yes', 'ON']) {
      assert.equal(transcriptOrderEnabled({ VOICE_TRANSCRIPT_ORDER: v }), true, v);
    }
  });
});

describe('greeting transcript slot (HD_f9b67efaf590 replay)', () => {
  it('flag on: greeting is the first row even though the caller spoke over it', async () => {
    const { turns } = await replayCallerOverGreeting({ enabled: true });
    assert.equal(turns[0].speaker, 'agent');
    assert.equal(turns[0].text, GREETING);
    assert.deepEqual(
      turns.map((r) => r.speaker),
      ['agent', 'caller', 'agent', 'caller', 'agent', 'caller']
    );
    assert.equal(turns.filter((r) => r.text === GREETING).length, 1);
  });

  it('flag off: order is unchanged from today (greeting after the overlapping turns)', async () => {
    const { turns } = await replayCallerOverGreeting({ enabled: false });
    assert.equal(turns[4].text, GREETING);
    assert.deepEqual(
      turns.map((r) => r.speaker),
      ['caller', 'agent', 'caller', 'agent', 'agent', 'caller']
    );
  });

  for (const enabled of [true, false]) {
    it(`flag ${enabled ? 'on' : 'off'}: no greeting row when nothing was spoken`, async () => {
      const { turns } = await replayCallerOverGreeting({ enabled, result: { ok: false } });
      assert.equal(turns.some((r) => r.text === GREETING), false);
      assert.equal(turns.length, 5);
    });

    it(`flag ${enabled ? 'on' : 'off'}: no greeting row on a speech outage`, async () => {
      const { turns } = await replayCallerOverGreeting({ enabled, result: { ok: false, outage: true } });
      assert.equal(turns.some((r) => r.text === GREETING), false);
    });

    it(`flag ${enabled ? 'on' : 'off'}: a throw releases the slot and still throws`, async () => {
      const boom = new Error('tts died');
      const { turns, error } = await replayCallerOverGreeting({ enabled, throws: boom });
      assert.equal(error, boom);
      assert.equal(turns.some((r) => r.text === GREETING), false);
      assert.equal(turns.length, 5);
    });
  }

  it('cached path (keep always true) reserves first with the flag on', async () => {
    const t = createCallTranscript();
    await speakWithTranscriptSlot({
      transcript: t,
      line: 'Hi',
      enabled: true,
      run: async () => {
        t.pushCaller('Hello');
        return { ok: true };
      },
    });
    assert.deepEqual(t.turns().map((r) => r.text), ['Hi', 'Hello']);
  });

  it('release only removes the reserved row', () => {
    const t = createCallTranscript();
    const a = t.reserveAgent('Same');
    t.pushAgent('Same');
    assert.equal(t.release(a), true);
    assert.equal(t.release(a), false);
    assert.equal(t.size(), 1);
    assert.equal(t.release(null), false);
  });

  it('latency stamping still targets the reply after the last caller turn', async () => {
    const t = createCallTranscript();
    await speakWithTranscriptSlot({
      transcript: t,
      line: GREETING,
      enabled: true,
      run: async () => {
        t.pushCaller('Hello');
        return { ok: true };
      },
    });
    t.pushAgent('How can I help?');
    t.stampFirstAgentSince(1, 640);
    const rows = t.turns();
    assert.equal(rows[0].latencyMs, null);
    assert.equal(rows[2].latencyMs, 640);
  });
});

// --- db.appendTranscript seq + missing-column fallback ---

let inserts = [];
let seqMissing = false;
let missingStyle = 'pgrst';

function fakeSupabase() {
  return {
    from(table) {
      if (table === 'calls') {
        const q = {
          select() {
            return q;
          },
          eq() {
            return q;
          },
          order() {
            return q;
          },
          limit() {
            return q;
          },
          maybeSingle: async () => ({ data: { id: 'call-uuid-1', sautikit_call_sid: 'HD_test' }, error: null }),
          single: async () => ({ data: { id: 'call-uuid-1', sautikit_call_sid: 'HD_test' }, error: null }),
        };
        return q;
      }
      assert.equal(table, 'transcripts');
      return {
        delete() {
          return { eq: async () => ({ error: null }) };
        },
        insert(payload) {
          return {
            select: async () => {
              inserts.push(payload);
              if (seqMissing && payload.some((r) => 'seq' in r)) {
                const error =
                  missingStyle === 'pg'
                    ? { code: '42703', message: 'column "seq" of relation "transcripts" does not exist' }
                    : { code: 'PGRST204', message: "Could not find the 'seq' column of 'transcripts' in the schema cache" };
                return { data: null, error };
              }
              return { data: payload, error: null };
            },
          };
        },
      };
    },
  };
}

let db;
const realWarn = console.warn;
before(() => {
  const clientPath = require.resolve('../src/lib/supabaseClient');
  require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: fakeSupabase() } };
  delete process.env.TENANT_ID;
  db = require('../src/db');
});

const TURNS = [
  { speaker: 'agent', text: GREETING, latencyMs: null },
  { speaker: 'caller', text: 'Niulize?', latencyMs: null },
  { speaker: 'agent', text: 'Je, naongea na Alvin?', latencyMs: 447 },
];

describe('db.appendTranscript seq', () => {
  const warnings = [];
  beforeEach(() => {
    inserts = [];
    seqMissing = false;
    missingStyle = 'pgrst';
    warnings.length = 0;
    console.warn = (...a) => warnings.push(a.join(' '));
    db.forgetTranscriptSeqColumn();
    delete process.env.VOICE_TRANSCRIPT_ORDER;
  });
  afterEach(() => {
    console.warn = realWarn;
    delete process.env.VOICE_TRANSCRIPT_ORDER;
  });

  it('flag off: payload is exactly today (no seq key)', async () => {
    await db.appendTranscript({ callSid: 'HD_test', turns: TURNS });
    assert.equal(inserts.length, 1);
    assert.deepEqual(Object.keys(inserts[0][0]).sort(), ['call_id', 'latency_ms', 'speaker', 'text_content']);
  });

  it('flag on: seq is the 0-based array index', async () => {
    process.env.VOICE_TRANSCRIPT_ORDER = 'on';
    const rows = await db.appendTranscript({ callSid: 'HD_test', turns: TURNS });
    assert.deepEqual(inserts[0].map((r) => r.seq), [0, 1, 2]);
    assert.deepEqual(rows.map((r) => r.text_content), TURNS.map((t) => t.text));
    assert.equal(rows[2].latency_ms, 447);
  });

  for (const style of ['pgrst', 'pg']) {
    it(`flag on, column missing (${style}): retries without seq once, then stops sending it`, async () => {
      process.env.VOICE_TRANSCRIPT_ORDER = 'on';
      seqMissing = true;
      missingStyle = style;
      const rows = await db.appendTranscript({ callSid: 'HD_test', turns: TURNS });
      assert.equal(inserts.length, 2);
      assert.ok('seq' in inserts[0][0]);
      assert.equal('seq' in inserts[1][0], false);
      assert.equal(rows.length, 3);
      assert.equal(warnings.filter((w) => /transcripts\.seq missing/.test(w)).length, 1);

      inserts = [];
      await db.appendTranscript({ callSid: 'HD_test', turns: TURNS });
      assert.equal(inserts.length, 1);
      assert.equal('seq' in inserts[0][0], false);
    });
  }

  it('an unrelated insert error still throws (no silent retry)', async () => {
    process.env.VOICE_TRANSCRIPT_ORDER = 'on';
    // A non-seq insert error must surface, not trigger the seq fallback.
    const clientPath = require.resolve('../src/lib/supabaseClient');
    const client = require.cache[clientPath].exports.supabase;
    const realFrom = client.from;
    client.from = (table) => {
      const q = realFrom(table);
      if (table !== 'transcripts') return q;
      return {
        ...q,
        insert: (payload) => ({
          select: async () => {
            inserts.push(payload);
            return { data: null, error: { code: '23503', message: 'insert violates foreign key constraint' } };
          },
        }),
      };
    };
    try {
      await assert.rejects(db.appendTranscript({ callSid: 'HD_test', turns: TURNS }), /foreign key/);
      assert.equal(inserts.length, 1);
    } finally {
      client.from = realFrom;
    }
  });
});
