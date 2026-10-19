'use strict';

const vm = require('vm');
const path = require('path');
const { execSync } = require('child_process');
const Module = require('module');

const LOOKUP_PATH = path.resolve(__dirname, '../../src/knowledge/lookup.js');
const REPO_ROOT = path.resolve(__dirname, '../..');

let cachedMainLookup;

/**
 * Load lookup exports from origin/main's src/knowledge/lookup.js for parity tests.
 * Relative requires resolve against the real lookup.js path in this repo.
 */
function loadMainLookup() {
  if (cachedMainLookup) return cachedMainLookup;
  const mainSource = execSync('git show origin/main:src/knowledge/lookup.js', {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const dirname = path.dirname(LOOKUP_PATH);
  const module = { exports: {} };
  const wrapper = Module.wrap(mainSource);
  const compiledWrapper = vm.runInThisContext(wrapper, { filename: LOOKUP_PATH });
  const req = (id) => (id.startsWith('.') ? require(path.join(dirname, id)) : require(id));
  compiledWrapper(module.exports, req, module, LOOKUP_PATH, dirname);
  cachedMainLookup = module.exports;
  return cachedMainLookup;
}

module.exports = { loadMainLookup };
