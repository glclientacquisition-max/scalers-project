'use strict';

/**
 * Read-time guard for saved alternate names (contact.metadata.alternate_names).
 * Older rows hold phrases the name extractor mistook for names ("impressed by
 * your", "not a"). Those must never reach the caller card, the shared-line
 * check, or the STT hint list. Real names and phrases that hold a name
 * ("Bwana Alvin", "Alvin speaking") stay.
 */

const { isJunkCallerName } = require('./callerNameQuality');
const { isPlausibleCallerName } = require('./entityExtraction');

function isSavedAlternateName(value) {
  const name = String(typeof value === 'string' ? value : value?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || isJunkCallerName(name)) return false;
  return isPlausibleCallerName(name);
}

module.exports = { isSavedAlternateName };
