'use strict';
// Map BA v2 write handlers onto the v1 tool parser that applyGeminiTools
// already executes. Live mode must write; shadow stays dry-run.

function first(results, action) {
  return (Array.isArray(results) ? results : []).find((row) => row && row.action === action) || null;
}

function succeeded(row) {
  return row && (row.status === 'succeeded' || row.status === 'updated' || row.status === 'ok');
}

function createLiveHandlers({ applyTools, ctx = {} } = {}) {
  if (typeof applyTools !== 'function') {
    throw new Error('createLiveHandlers needs applyTools');
  }
  // BRAIN_ENGINES: receipts carry calls.id (uuid). Voice passes only the SID, so resolve it once per call
  // (ctx.resolveCallId, set on the engines path only). Off / no resolver = today's behaviour.
  let callIdP = null;
  const callIdFor = async () => {
    if (ctx.callId || typeof ctx.resolveCallId !== 'function' || !ctx.callSid) return ctx.callId || null;
    if (!callIdP) callIdP = Promise.resolve().then(() => ctx.resolveCallId(ctx.callSid)).catch(() => null);
    const id = await callIdP;
    if (!id) callIdP = null; // the calls row may not exist yet on an early turn: try again next receipt
    return id || null;
  };
  return {
    createAppointment: async (args) => {
      const execution = await applyTools({ appointment: args });
      const row = first(execution?.results, 'create_appointment');
      return { id: row?.id || null, ok: succeeded(row), saved: row?.value || null };
    },
    createServiceRequest: async (args) => {
      const execution = await applyTools({ serviceRequest: args });
      const row = first(execution?.results, 'create_service_request');
      return { id: row?.id || null, ok: succeeded(row) };
    },
    addAppointmentService: async (args) => {
      const execution = await applyTools({ appointmentAddService: args });
      const row = first(execution?.results, 'add_appointment_service');
      return { id: row?.id || null, ok: succeeded(row) || row?.status === 'duplicate', duplicate: row?.status === 'duplicate' };
    },
    updateAppointment: async (args) => {
      const execution = await applyTools({ appointmentUpdate: args });
      const row = first(execution?.results, 'update_appointment');
      return { id: row?.id || args.appointmentId || null, ok: succeeded(row), saved: row?.value || null };
    },
    escalate: async (args) => {
      const execution = await applyTools({ escalate: args });
      const row = first(execution?.results, 'escalate');
      return { ok: !row || succeeded(row) || row.status !== 'failed', id: row?.id || row?.taskId || null };
    },
    // BRAIN_V2_COMMIT_SAFETY: Platform #845 receipts (never throws) and #844 name confirm (after a read-back yes).
    recordWriteReceipt: async (rec) => {
      if (typeof ctx.recordWriteReceipt !== 'function') return { ok: false, skipped: 'no_sink' };
      try {
        const callId = typeof ctx.resolveCallId === 'function' ? (await callIdFor()) : null;
        return await ctx.recordWriteReceipt({ ...rec, tenantId: ctx.tenantId || null, callId: callId || ctx.callId || ctx.callSid || null, callSid: ctx.callSid || null });
      } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    },
    confirmCallerName: async ({ name, source = 'readback_yes' } = {}) => {
      if (typeof ctx.confirmCallerName !== 'function') return { ok: false, skipped: 'no_confirm_caller_name' };
      try { return await ctx.confirmCallerName({ tenantId: ctx.tenantId || null, phone: ctx.callerPhone || null, name, source, callId: ctx.callId || null }); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
    },
    saveCallerInfo: async (args) => {
      const execution = await applyTools({ saveCallerInfo: args, name: args?.name });
      const row = first(execution?.results, 'save_caller_info');
      return { ok: !row || succeeded(row) };
    },
  };
}

module.exports = { createLiveHandlers };
