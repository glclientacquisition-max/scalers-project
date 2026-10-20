'use strict';
// Dry-run write handlers for BRAIN_V2_MODE=shadow: nothing is written, every
// intended write is recorded so Voice can log toolIntents / agreement.
function createDryRunHandlers({ log = [] } = {}) {
  const rec = (name, args, ret) => { log.push({ name, args, at: Date.now() }); return ret; };
  return {
    log,
    createAppointment: async (args) => rec('createAppointment', args, { id: null, dryRun: true, intended: args }),
    createServiceRequest: async (args) => rec('createServiceRequest', args, { id: null, dryRun: true, intended: args }),
    updateAppointment: async (args) => rec('updateAppointment', args, { id: null, dryRun: true, intended: args }),
    escalate: async (args) => rec('escalate', args, { ok: true, dryRun: true, intended: args }),
    saveCallerInfo: async (args) => rec('saveCallerInfo', args, { dryRun: true, intended: args }),
  };
}
module.exports = { createDryRunHandlers };
