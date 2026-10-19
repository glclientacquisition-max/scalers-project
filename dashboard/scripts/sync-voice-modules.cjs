#!/usr/bin/env node
'use strict';
// Copy the voice require closure into dashboard/.voice/ (gitignored) so the
// Vercel function bundle carries it. Fails the build if the voice sources are
// missing or need an npm package the Desk does not install.
const fs = require('node:fs');
const path = require('node:path');
const { voiceClosure } = require('./voice-modules.cjs');

const DASH = path.join(__dirname, '..');
const REPO = path.join(DASH, '..');
const OUT = path.join(DASH, '.voice');

const { files, npm, missing } = voiceClosure(REPO);
if (missing.length) {
  console.error(`sync-voice-modules: voice entry missing: ${missing.join(', ')} (is ../src in the build checkout?)`);
  process.exit(1);
}
const deskPkg = JSON.parse(fs.readFileSync(path.join(DASH, 'package.json'), 'utf8'));
const deskDeps = { ...(deskPkg.dependencies || {}), ...(deskPkg.devDependencies || {}) };
const absent = npm.filter((name) => !deskDeps[name]);
if (absent.length) {
  console.error(`sync-voice-modules: voice closure needs npm packages the Desk lacks: ${absent.join(', ')}`);
  process.exit(1);
}
fs.rmSync(OUT, { recursive: true, force: true });
for (const rel of files) {
  const dest = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), dest);
}
fs.writeFileSync(path.join(OUT, 'package.json'), JSON.stringify({ name: 'scalers-voice-copy', private: true, type: 'commonjs' }, null, 2) + '\n');
console.log(`sync-voice-modules: copied ${files.length} voice files to dashboard/.voice`);
