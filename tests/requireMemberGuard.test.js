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
    if (ALLOW.has(m[1]) || /^\s*const denied = await memberDenied\("[a-z.]+"\);/.test(first)) continue;
    // Thin wrapper that only forwards to a guarded action in the same file (confirmPriceAction).
    const forward = /^\s*return (\w+)\(/.exec(first);
    if (forward && forward[1] !== m[1] && guardedInFile(src, forward[1])) continue;
    // Parallel request checks: memberDenied runs first inside Promise.all and the denial returns
    // before any other statement that can write (saveAndCompileSettings).
    const rest = src.slice(body, body + 600);
    if (/^(\s*(\/\/[^\n]*|const \w+ = Date\.now\(\);)\n)*\s*const \[denied\b[^\]]*\] = await Promise\.all\(\[\s*memberDenied\("[a-z.]+"\),[^\]]*\]\);\n(\s*const \w+ = Date\.now\(\);\n)?\s*if \(denied\) return denied;/.test(rest)) continue;
    missing.push(m[1]);
  }
  return missing;
}

function guardedInFile(src, name) {
  const at = src.indexOf(`export async function ${name}(`);
  if (at < 0) return false;
  const body = src.indexOf(' {\n', at) + 3;
  return /^\s*const denied = await memberDenied\("[a-z.]+"\);/.test(src.slice(body, src.indexOf('\n', body)));
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
  // A memberCan check is not enough: it skips the closed-business check memberDenied makes.
  assert.deepEqual(actionsMissingGuard('export async function x(): Promise<void> {\n  if (!(await memberCan("settings.edit"))) return;\n}\n'), ['x']);
  // Forwarding to an unguarded action, or a Promise.all whose denial is not returned first, still fails.
  assert.deepEqual(actionsMissingGuard('export async function a(): Promise<void> {\n  return b();\n}\nexport async function b(): Promise<void> {\n  return;\n}\n'), ['a', 'b']);
  assert.deepEqual(
    actionsMissingGuard('export async function p(): Promise<void> {\n  const [denied, t] = await Promise.all([\n    memberDenied("settings.edit"),\n    getT(),\n  ]);\n  await write();\n  if (denied) return denied;\n}\n'),
    ['p']
  );
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
