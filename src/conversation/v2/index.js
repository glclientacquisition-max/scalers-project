'use strict';
// BA v2 Brain (Phase 1). Behind BRAIN_V2 (off by default; see flag.js).
module.exports = { ...require('./flag'), ...require('./machine'), catalogue: require('./catalogue'), gemini: require('./gemini'), receipts: require('./receipts'), owner: require('./owner'), nlu: require('./nlu'), lexicon: require('./lexicon') };
