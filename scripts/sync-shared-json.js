#!/usr/bin/env node
'use strict';
// Server-owned JSON lives in src/shared/ (the Voice image copies src/).
// Desk's Turbopack root is dashboard/, so it can't import ../src; it keeps a
// committed mirror. Run after editing a src/shared file:  node scripts/sync-shared-json.js
// tests/sharedJsonBoundary.test.js fails if a mirror drifts.
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const MIRRORS = {
  'src/shared/alertTypeDefaults.json': 'dashboard/src/lib/alertTypeDefaults.json',
  'src/shared/kenyaAreaTree.v1.json': 'dashboard/src/lib/data/kenyaAreaTree.v1.json',
};
if (require.main === module) {
  for (const [src, dst] of Object.entries(MIRRORS)) {
    fs.copyFileSync(path.join(ROOT, src), path.join(ROOT, dst));
    console.log(`sync-shared-json: ${src} -> ${dst}`);
  }
}
module.exports = { MIRRORS };
