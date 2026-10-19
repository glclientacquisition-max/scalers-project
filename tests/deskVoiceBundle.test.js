'use strict';
// Desk server code that require()s Voice modules must get them from the build
// copy (dashboard/.voice), not ../src: Vercel ships only dashboard/. Staging
// dpl_6Quwj7p5… crashed /home and /settings with MODULE_NOT_FOUND
// ./src/tenantProfile.js because the bridge used process.cwd()/.. at runtime.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const DASH = path.join(REPO, 'dashboard');
const { VOICE_ENTRIES, voiceClosure } = require(path.join(DASH, 'scripts', 'voice-modules.cjs'));

function deskSources(dir = path.join(DASH, 'src'), out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) deskSources(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(ent.name) && !/\.test\./.test(ent.name)) out.push(p);
  }
  return out;
}

const RESOLVER = path.join(DASH, 'src', 'lib', 'voiceRequire.server.ts');

test('only voiceRequire.server.ts builds a require() for repo files', () => {
  const offenders = [];
  for (const file of deskSources()) {
    if (file === RESOLVER) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (/\bcreateRequire\s*\(/.test(src) || /process\.cwd\(\)\s*,\s*["']\.\.["']/.test(src)) {
      offenders.push(path.relative(REPO, file));
    }
  }
  assert.deepEqual(offenders, [], 'use requireVoice() from @/lib/voiceRequire.server');
});

test('every requireVoice("./…") target is a synced voice entry', () => {
  const used = new Set();
  for (const file of deskSources()) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/requireVoice(?:<[^>]*>)?\(\s*["'`]\.\/([^"'`]+)["'`]/g)) used.add(m[1]);
  }
  assert.ok(used.size > 0, 'expected the assistant-say bridge to use requireVoice');
  const missing = [...used].filter((rel) => !VOICE_ENTRIES.includes(rel));
  assert.deepEqual(missing, [], 'add these to VOICE_ENTRIES in dashboard/scripts/voice-modules.cjs');
});

test('voice closure needs no npm package the Desk does not install', () => {
  const { npm, missing } = voiceClosure(REPO);
  assert.deepEqual(missing, []);
  const pkg = JSON.parse(fs.readFileSync(path.join(DASH, 'package.json'), 'utf8'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  assert.deepEqual(npm.filter((n) => !deps[n]), []);
});

test('sync copy loads every entry with no access to ../src', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-voice-'));
  try {
    // Mimic the Vercel function: only dashboard/ (no repo src/) next to the copy.
    const dash = path.join(tmp, 'dashboard');
    fs.mkdirSync(path.join(dash, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    for (const f of ['voice-modules.cjs', 'sync-voice-modules.cjs']) {
      fs.copyFileSync(path.join(DASH, 'scripts', f), path.join(dash, 'scripts', f));
    }
    fs.copyFileSync(path.join(DASH, 'package.json'), path.join(dash, 'package.json'));
    for (const rel of voiceClosure(REPO).files) {
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(REPO, rel), dest);
    }
    execFileSync(process.execPath, [path.join(dash, 'scripts', 'sync-voice-modules.cjs')], { stdio: 'pipe' });
    fs.rmSync(path.join(tmp, 'src'), { recursive: true, force: true }); // repo src gone, like /var/task
    const probe = VOICE_ENTRIES.map((e) => `require(${JSON.stringify('./' + e)});`).join('');
    execFileSync(process.execPath, ['-e', `const r=require('node:module').createRequire(${JSON.stringify(path.join(dash, '.voice', 'package.json'))});${probe.replace(/require\(/g, 'r(')}`], {
      stdio: 'pipe',
      cwd: dash,
      env: { ...process.env, NODE_PATH: path.join(DASH, 'node_modules') },
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
