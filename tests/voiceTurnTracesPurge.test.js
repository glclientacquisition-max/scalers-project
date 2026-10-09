// voice_turn_traces retention, executed for real in an in-process Postgres
// (PGlite): the created_at index, the batched purge function (cron-compatible
// signature) and the commit-per-batch procedure pg_cron calls.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let db;

async function count(where = 'true') {
  const { rows } = await db.query(`select count(*)::int as n from public.voice_turn_traces where ${where}`);
  return rows[0].n;
}

/** n rows created `days` days ago, spread over one hour so batches are not all equal timestamps. */
async function seed(n, days, callId) {
  await db.query(
    `insert into public.voice_turn_traces (call_id, turn_index, record_kind, payload, created_at)
     select $1, g, 'turn', '{}'::jsonb, now() - make_interval(days => $2) - make_interval(secs => g % 3600)
     from generate_series(1, $3) g`,
    [callId, days, n]
  );
}

async function reset() {
  await db.exec('truncate public.voice_turn_traces');
  await seed(12000, 40, 'old-40d');
  await seed(7, 31, 'old-31d');
  await seed(25, 29, 'keep-29d');
  await seed(40, 0, 'keep-today');
}

describe('voice_turn_traces purge (PGlite)', () => {
  before(async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
    `);
    await db.exec(read('docs/supabase/voice_turn_traces.sql'));
    // The standalone index file must also apply cleanly on top (idempotent).
    await db.exec(read('docs/supabase/voice_turn_traces_created_at_idx.sql'));
  });

  it('has a created_at index the purge can range-scan', async () => {
    const { rows } = await db.query(
      `select indexdef from pg_indexes
       where schemaname = 'public' and tablename = 'voice_turn_traces'
         and indexname = 'voice_turn_traces_created_at_idx'`
    );
    assert.equal(rows.length, 1);
    assert.match(rows[0].indexdef, /\(created_at\)/);
  });

  it('function keeps its cron-compatible signature and deletes in batches', async () => {
    await reset();
    const { rows } = await db.query('select public.purge_voice_turn_traces(30) as n');
    assert.equal(rows[0].n, 12007);
    assert.equal(await count(), 65);
    assert.equal(await count(`call_id like 'keep-%'`), 65);
    const again = await db.query('select public.purge_voice_turn_traces() as n');
    assert.equal(again.rows[0].n, 0);
  });

  it('function treats null and <1 days as safe values', async () => {
    await reset();
    const { rows } = await db.query('select public.purge_voice_turn_traces(null) as n');
    assert.equal(rows[0].n, 12007);
    await seed(3, 2, 'two-days');
    const zero = await db.query('select public.purge_voice_turn_traces(0) as n');
    // 0 is clamped to 1 day: the 29-day and 2-day rows go, today's rows stay.
    assert.equal(zero.rows[0].n, 28, 'minimum is 1 day, never "delete everything"');
    assert.equal(await count(`call_id = 'keep-today'`), 40);
  });

  it('procedure commits per batch and reports the total', async () => {
    await reset();
    const { rows } = await db.query('call public.purge_voice_turn_traces_batched(30)');
    assert.equal(rows[0].p_deleted, 12007);
    assert.equal(await count(), 65);
    const small = await db.query('call public.purge_voice_turn_traces_batched(30, 1000)');
    assert.equal(small.rows[0].p_deleted, 0);
  });

  it('procedure with a small batch size loops until the backlog is gone', async () => {
    await reset();
    const { rows } = await db.query('call public.purge_voice_turn_traces_batched(30, 100)');
    assert.equal(rows[0].p_deleted, 12007);
    assert.equal(await count(`call_id like 'old-%'`), 0);
    assert.equal(await count(`call_id like 'keep-%'`), 65);
  });

  it('procedure really COMMITs (refuses to run inside a transaction block)', async () => {
    await reset();
    await assert.rejects(
      db.exec('begin; call public.purge_voice_turn_traces_batched(30); commit;'),
      /invalid transaction termination/
    );
    await db.exec('rollback').catch(() => {});
    assert.equal(await count(), 12072, 'nothing deleted when the call failed');
  });

  it('procedure has no SET clause and neither entry point is security definer', async () => {
    const { rows } = await db.query(
      `select proname, prokind, prosecdef, proconfig from pg_proc
       where proname in ('purge_voice_turn_traces', 'purge_voice_turn_traces_batched')
       order by proname`
    );
    assert.equal(rows.length, 2);
    for (const r of rows) assert.equal(r.prosecdef, false, r.proname);
    const proc = rows.find((r) => r.proname === 'purge_voice_turn_traces_batched');
    assert.equal(proc.prokind, 'p');
    assert.equal(proc.proconfig, null, 'a SET clause would make COMMIT illegal');
  });

  it('only service_role can execute either entry point', async () => {
    const { rows } = await db.query(
      `select r.rolname,
              has_function_privilege(r.rolname, 'public.purge_voice_turn_traces(integer)', 'execute') as fn,
              has_function_privilege(r.rolname, 'public.purge_voice_turn_traces_batched(integer, integer, integer)', 'execute') as proc
       from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname`
    );
    assert.deepEqual(
      rows.map((r) => [r.rolname, r.fn, r.proc]),
      [
        ['anon', false, false],
        ['authenticated', false, false],
        ['service_role', true, true],
      ]
    );
  });

  it('cron file calls the batched procedure under the existing job name', () => {
    const cron = read('docs/supabase/voice_turn_traces_cron.sql');
    assert.match(cron, /'purge_voice_turn_traces_daily',\s*'17 0 \* \* \*',\s*\$\$call public\.purge_voice_turn_traces_batched\(30\)\$\$/);
  });
});
