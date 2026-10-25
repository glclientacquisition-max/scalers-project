'use strict';
// BRAIN_MODEL_LEAD split path: the full #933 20-case set (+hedge/G5/gates) re-run with understanding and reply as
// two parallel calls (BRAIN_MODEL_LEAD_SPLIT on). Split-specific replays live in brainModelLeadSplitCalls.test.js.
process.env.BRAIN_LEAD_CASES_SPLIT = 'on';
require('./brainModelLead.test.js');
