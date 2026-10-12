'use strict';

/** VOICE_SPOKEN_FACTS: on only when exactly 'on'. Off is today's behaviour. */
function spokenFactsEnabled(env = process.env) {
  return Boolean(env) && env.VOICE_SPOKEN_FACTS === 'on';
}

module.exports = { spokenFactsEnabled };
