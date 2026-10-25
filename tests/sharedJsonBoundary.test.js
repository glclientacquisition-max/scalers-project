'use strict';
// The Voice image copies server.js, db.js and src/ — not dashboard/ (see Dockerfile).
// #948 required dashboard/… from src/ and the staging restage crashed. Guard both halves.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MIRRORS } = require('../scripts/sync-shared-json');

const ROOT = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
  return /\.(c|m)?js$|\.ts$/.test(e.name) ? [p] : [];
});
const files = [path.join(ROOT, 'server.js'), path.join(ROOT, 'db.js'), ...walk(path.join(ROOT, 'src'))];

// Known, not loaded by server.js today (only tests/invoiceDocuments.test.js requires it).
// Wiring it into the server would crash the image the same way; move money.js to src/shared/ first.
const ALLOW = new Set(['src/billing/invoiceNotices.js']);

test('server runtime code never imports from dashboard/', () => {
  const bad = [];
  const re = /(require\s*\(|import\s*\(|from\s+)[^)\n;]*dashboard[\\/'"]/;
  for (const f of files) {
    if (ALLOW.has(path.relative(ROOT, f).split(path.sep).join('/'))) continue;
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (re.test(line)) bad.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `server code reaches into dashboard/ (not in the Voice image). Move the file to src/shared/:\n${bad.join('\n')}`);
});

test('Desk mirrors of src/shared JSON are byte-identical (run scripts/sync-shared-json.js)', () => {
  for (const [src, dst] of Object.entries(MIRRORS)) {
    assert.equal(fs.readFileSync(path.join(ROOT, dst), 'utf8'), fs.readFileSync(path.join(ROOT, src), 'utf8'), `${dst} drifted from ${src}`);
  }
});
