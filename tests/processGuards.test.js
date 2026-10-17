// Process-level net: unhandledRejection logs once per signature (rate
// limited) and keeps the process alive; uncaughtException stays fatal.
// Run: node --test tests/processGuards.test.js

const { describe, it } = require('node:test');
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  createSignatureLimiter,
  rejectionSignature,
  installProcessGuards,
} = require('../src/lib/processGuards');

const GUARDS = path.join(__dirname, '..', 'src', 'lib', 'processGuards.js');

function runChild(body) {
  const script = `const { installProcessGuards } = require(${JSON.stringify(GUARDS)});\n${body}`;
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
}

describe('rejectionSignature', () => {
  it('one site with different ids and numbers is one signature', () => {
    const mk = (sid, ms) => {
      const e = new Error(`Soniox TTS socket closed (1001) call ${sid} after ${ms}ms`);
      e.stack = `Error: x\n    at lineLost (/app/src/speech/sonioxTts.js:407:${ms % 50})\n    at foo (/app/x.js:1:1)`;
      return e;
    };
    assert.equal(rejectionSignature(mk('HD_116ff6a67508', 120)), rejectionSignature(mk('HD_1e4e3e955169', 9031)));
  });

  it('different messages are different signatures; non-errors are handled', () => {
    assert.notEqual(rejectionSignature(new Error('a')), rejectionSignature(new Error('b')));
    assert.match(rejectionSignature('plain string'), /^non-error\(string\)/);
    assert.match(rejectionSignature(undefined), /^non-error\(undefined\)/);
    const circular = {};
    circular.self = circular;
    assert.doesNotThrow(() => rejectionSignature(circular));
  });
});

describe('createSignatureLimiter', () => {
  it('logs the first hit, counts repeats in the window, summarises after it', () => {
    let t = 0;
    const lim = createSignatureLimiter({ windowMs: 1000, now: () => t });
    assert.deepEqual(lim.hit('A'), { log: true, first: true, suppressed: 0, total: 1 });
    t = 10;
    assert.equal(lim.hit('A').log, false);
    assert.equal(lim.hit('A').log, false);
    assert.equal(lim.hit('B').log, true, 'other signatures are independent');
    t = 1500;
    assert.deepEqual(lim.hit('A'), { log: true, first: false, suppressed: 2, total: 4 });
    t = 1600;
    assert.equal(lim.hit('A').log, false);
  });

  it('caps memory', () => {
    const lim = createSignatureLimiter({ maxSignatures: 3, now: () => 0 });
    for (const s of ['a', 'b', 'c', 'd', 'e']) lim.hit(s);
    assert.equal(lim.size(), 3);
  });
});

describe('installProcessGuards (in-process, injected)', () => {
  it('installs once, logs rejections, exits 1 on uncaught exception', () => {
    const { EventEmitter } = require('events');
    const proc = new EventEmitter();
    const lines = [];
    const exits = [];
    const log = { error: (m) => lines.push(['error', m]), warn: (m) => lines.push(['warn', m]) };
    const h = installProcessGuards({ proc, log, exit: (c) => exits.push(c), windowMs: 1000, now: () => 0 });
    assert.equal(installProcessGuards({ proc, log }), h, 'idempotent');
    assert.equal(proc.listenerCount('unhandledRejection'), 1);
    proc.emit('unhandledRejection', new Error('boom'));
    proc.emit('unhandledRejection', new Error('boom'));
    assert.equal(lines.length, 1);
    assert.match(lines[0][1], /unhandledRejection \(kept running/);
    assert.deepEqual(exits, []);
    proc.emit('uncaughtException', new Error('sync throw'), 'uncaughtException');
    assert.deepEqual(exits, [1]);
    assert.match(lines[1][1], /uncaughtException .*fatal, exiting 1/);
  });
});

describe('real process', () => {
  it('unhandled rejections: logged once per signature, process keeps running', () => {
    const r = runChild(`
      installProcessGuards();
      const fire = (m) => { const e = new Error(m); Promise.reject(e); };
      for (let i = 0; i < 5; i++) fire('Soniox TTS socket closed (1001) n=' + i);
      Promise.reject(new Error('supabase write failed'));
      setTimeout(() => { console.log('alive after rejections'); process.exit(0); }, 50);
    `);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /alive after rejections/);
    const firsts = r.stderr.match(/unhandledRejection \(kept running/g) || [];
    assert.equal(firsts.length, 2, `one per signature, got:\n${r.stderr}`);
  });

  it('uncaught exception: logged and fatal (exit 1)', () => {
    const r = runChild(`
      installProcessGuards();
      setTimeout(() => { throw new Error('sync bug'); }, 5);
      setTimeout(() => console.log('should not print'), 200);
    `);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /uncaughtException .*fatal, exiting 1/);
    assert.match(r.stderr, /sync bug/);
    assert.doesNotMatch(r.stdout, /should not print/);
  });
});
