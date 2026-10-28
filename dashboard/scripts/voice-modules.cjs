'use strict';
// Voice modules the Desk server requires at runtime (assistant-say bridge).
// Vercel builds the Desk from dashboard/ and only ships what it traces under
// dashboard/, so ../src/*.js is NOT in the function bundle. sync-voice-modules
// copies the static require closure of these entries into dashboard/.voice/
// before `next build`; next.config.ts traces .voice/** into every route.
const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');

/** Entry files (repo-relative). Every requireVoice("./…") target must be listed. */
const VOICE_ENTRIES = [
  'src/tenantProfile.js',
  'src/knowledge/assistantSayReadiness.js',
  'src/knowledge/lookup.js',
  'src/knowledge/lookupOwnerReason.js',
  'src/knowledge/kb/kbLive.js', // shared isKbLive contract (lib/kbLive.server.ts)
  'src/knowledge/kb/live.js', // snapshot attach for the KB preview (lib/kbCaller.server.ts)
  'src/knowledge/kb/source.js', // the one catalogue door (greeting line in the KB preview)
];

function resolveRel(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Static closure of relative require('…') strings, lazy ones included.
 * Returns repo-relative files and any npm packages the closure needs.
 */
function voiceClosure(repoRoot, entries = VOICE_ENTRIES) {
  const seen = new Set();
  const npm = new Set();
  const missing = [];
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!file.endsWith('.js')) return;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(\s*(['"`])([^'"`]+)\1\s*\)/g)) {
      const spec = m[2];
      if (spec.startsWith('.')) {
        const hit = resolveRel(file, spec);
        if (hit) walk(hit);
        // Unresolved relative requires are optional modules guarded by try/catch.
      } else {
        const name = spec.replace(/^node:/, '');
        if (!builtinModules.includes(name)) npm.add(spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
      }
    }
  };
  for (const entry of entries) {
    const abs = path.join(repoRoot, entry);
    if (!fs.existsSync(abs)) missing.push(entry);
    else walk(abs);
  }
  return {
    files: [...seen].map((f) => path.relative(repoRoot, f)).sort(),
    npm: [...npm].sort(),
    missing,
  };
}

module.exports = { VOICE_ENTRIES, voiceClosure };
