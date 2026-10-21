'use strict';
// Map BA v2 write handlers onto the v1 tool parser that applyGeminiTools
// already executes. Live mode must write; shadow stays dry-run.

function first(results, action) {
  return (Array.isArray(results) ? results : []).find((row) => row && row.action === action) || null;
}

function succeeded(row) {
  return row && (row.status === 'succeeded' || row.status === 'updated' || row.status === 'ok');
}

function createLiveHandlers({ applyTools } = {}) {
  if (typeof applyTools !== 'function') {
    throw new Error('createLiveHandlers needs applyTools');
  }
  return {
    createAppointment: async (args) => {
      const execution = await applyTools({ appointment: args });
      const row = first(execution?.results, 'create_appointment');
      return { id: row?.id || null, ok: succeeded(row) };
    },
    createServiceRequest: async (args) => {
      const execution = await applyTools({ serviceRequest: args });
      const row = first(execution?.results, 'create_service_request');
      return { id: row?.id || null, ok: succeeded(row) };
    },
    updateAppointment: async (args) => {
      const execution = await applyTools({ appointmentUpdate: args });
      const row = first(execution?.results, 'update_appointment');
      return { id: row?.id || args.appointmentId || null, ok: succeeded(row) };
    },
    escalate: async (args) => {
      const execution = await applyTools({ escalate: args });
      const row = first(execution?.results, 'escalate');
      return { ok: !row || succeeded(row) || row.status !== 'failed' };
    },
    saveCallerInfo: async (args) => {
      const execution = await applyTools({ saveCallerInfo: args, name: args?.name });
      const row = first(execution?.results, 'save_caller_info');
      return { ok: !row || succeeded(row) };
    },
  };
}

module.exports = { createLiveHandlers };
