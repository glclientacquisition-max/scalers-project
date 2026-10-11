/**
 * Every desk server action must call memberDenied(action) as its first statement and return
 * the denial (never throw: thrown errors are redacted by Next and crash the page).
 * Fails when a new "use server" export under dashboard/src/app/(desk) lacks it.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { it } = require('node:test');

const ROOT = path.join(__dirname, '..', 'dashboard', 'src', 'app', '(desk)');
// Membership-checked by its own query (switches between the user's memberships).
const ALLOW = new Set(['switchDeskTenant']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

function actionsMissingGuard(src) {
  const missing = [];
  const re = /export async function (\w+)\(/g;
  let m;
  while ((m = re.exec(src))) {
    let j = re.lastIndex;
    let depth = 1;
    while (depth) {
      const c = src[j++];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
    }
    const body = src.indexOf(' {\n', j) + 3;
    const first = src.slice(body, src.indexOf('\n', body));
    if (!ALLOW.has(m[1]) && !/^\s*const denied = await memberDenied\("[a-z.]+"\);/.test(first)) missing.push(m[1]);
  }
  return missing;
}

it('every desk server action calls memberDenied first', () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/^"use server";/m.test(src)) continue;
    for (const name of actionsMissingGuard(src)) offenders.push(`${path.relative(ROOT, file)}:${name}`);
  }
  assert.deepEqual(offenders, []);
});

it('the guard detector catches a missing call', () => {
  assert.deepEqual(actionsMissingGuard('export async function x(a: string): Promise<void> {\n  return;\n}\n'), ['x']);
});

it('the next line returns the denial', () => {
  for (const file of walk(ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/^"use server";/m.test(src)) continue;
    const re = /const denied = await memberDenied\("[a-z.]+"\);\n(.*)\n/g;
    let m;
    while ((m = re.exec(src))) assert.match(m[1], /^\s*if \(denied\) return\b/, path.relative(ROOT, file));
    assert.doesNotMatch(src, /await requireMember\(/, `${path.relative(ROOT, file)} still throws via requireMember`);
  }
});
