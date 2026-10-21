#!/usr/bin/env node
'use strict';
// After `next build`: fail if a server route that runs the assistant-say bridge
// would ship without the voice files. Reads Next's .nft.json trace files.
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_ENTRIES } = require('./voice-modules.cjs');

const DASH = path.join(__dirname, '..');
const SERVER = path.join(DASH, '.next', 'server', 'app');
const ROUTES = ['(desk)/settings/page', '(desk)/settings/[section]/page', '(desk)/home/page'];
const need = VOICE_ENTRIES.map((e) => path.join(DASH, '.voice', e));

let bad = 0;
for (const route of ROUTES) {
  const nft = path.join(SERVER, `${route}.js.nft.json`);
  if (!fs.existsSync(nft)) {
    console.error(`check-voice-trace: no trace file for ${route} (${path.relative(DASH, nft)})`);
    bad++;
    continue;
  }
  const traced = new Set(JSON.parse(fs.readFileSync(nft, 'utf8')).files.map((f) => path.resolve(path.dirname(nft), f)));
  const lost = need.filter((f) => !traced.has(f));
  if (lost.length) {
    console.error(`check-voice-trace: ${route} does not ship ${lost.map((f) => path.relative(DASH, f)).join(', ')}`);
    bad++;
  } else {
    console.log(`check-voice-trace: ${route} ships ${need.length} voice entries`);
  }
}
process.exit(bad ? 1 : 0);
