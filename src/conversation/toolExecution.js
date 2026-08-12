// Validate and execute model-proposed actions, returning backend-confirmed outcomes.

const REQUEST_TYPES = new Set(['hold', 'enquiry', 'order', 'callback', 'other']);

function clean(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function stableFingerprint(action, payload) {
  const normalized = Object.fromEntries(
    Object.entries(payload || {})
      .map(([key, value]) => [key, clean(value).toLowerCase()])
      .filter(([, value]) => value)
      .sort(([a], [b]) => a.localeCompare(b))
  );
  return `${action}:${JSON.stringify(normalized)}`;
}

function validateServiceRequest(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'Missing service request payload.' };
  }
  const typeRaw = clean(raw.type || 'enquiry', 40).toLowerCase();
  const type = REQUEST_TYPES.has(typeRaw) ? typeRaw : 'enquiry';
  const value = {
    type,
    name: clean(raw.name, 120),
    phone: clean(raw.phone, 40),
    item: clean(raw.item, 200),
    quantity: clean(raw.quantity, 80),
    whenText: clean(raw.whenText, 160),
    notes: clean(raw.notes, 400),
  };
  if (!value.item && !value.notes) {
    return { valid: false, reason: 'A request needs an item or concise notes.' };
  }
  // Retail hold/pickup: require product + caller name + when (playbook slots).
  if (type === 'hold') {
    const missing = [];
    if (!value.item) missing.push('item');
    if (!value.name) missing.push('name');
    if (!value.whenText) missing.push('when_text');
    if (missing.length) {
      return {
        valid: false,
        reason: `Hold needs ${missing.join(', ')} before saving.`,
        missingSlots: missing,
        value,
      };
    }
  }
  // Orders: require product + name (when optional).
  if (type === 'order') {
    const missing = [];
    if (!value.item) missing.push('item');
    if (!value.name) missing.push('name');
    if (missing.length) {
      return {
        valid: false,
        reason: `Order needs ${missing.join(', ')} before saving.`,
        missingSlots: missing,
        value,
      };
    }
  }
  return { valid: true, value };
}

function validateCallerInfo(parsed) {
  const value = {
    name: clean(parsed?.name, 120),
    reason: clean(parsed?.reason, 400),
  };
  return {
    valid: Boolean(value.name || value.reason),
    value,
    reason: value.name || value.reason ? '' : 'No caller information supplied.',
  };
}

function validateEscalation(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'Missing escalation payload.' };
  }
  const value = {
    teammate: clean(raw.teammate, 120),
    name: clean(raw.name, 120),
    reason: clean(raw.reason, 400),
  };
  if (!value.reason) {
    return { valid: false, reason: 'Escalation requires a reason.' };
  }
  return { valid: true, value };
}

async function executeBrainTools({
  parsed,
  capabilities = {},
  handlers = {},
  completedFingerprints = [],
} = {}) {
  const completed = new Set(completedFingerprints);
  const results = [];

  if (Array.isArray(parsed?.errors)) {
    for (const error of parsed.errors) {
      results.push({
        action: 'tool_request',
        status: 'invalid',
        reason: clean(error?.message || 'Invalid tool request.', 300),
      });
    }
  }

  if (parsed?.serviceRequest) {
    const validation = validateServiceRequest(parsed.serviceRequest);
    const fingerprint = validation.valid
      ? stableFingerprint('create_service_request', validation.value)
      : null;
    if (!capabilities.createServiceRequest) {
      results.push({
        action: 'create_service_request',
        status: 'disabled',
        reason: 'Request creation is not available.',
      });
    } else if (!validation.valid) {
      results.push({
        action: 'create_service_request',
        status: 'invalid',
        reason: validation.reason,
        missingSlots: validation.missingSlots || [],
      });
    } else if (completed.has(fingerprint)) {
      results.push({
        action: 'create_service_request',
        status: 'duplicate',
        fingerprint,
      });
    } else {
      try {
        const created = await handlers.createServiceRequest?.(validation.value);
        results.push(
          created
            ? {
                action: 'create_service_request',
                status: 'succeeded',
                fingerprint,
                id: created.id || null,
                requestType: created.request_type || validation.value.type,
                value: validation.value,
                record: created,
              }
            : {
                action: 'create_service_request',
                status: 'failed',
                fingerprint,
                reason: 'The backend did not create a request.',
              }
        );
      } catch (error) {
        results.push({
          action: 'create_service_request',
          status: 'failed',
          fingerprint,
          reason: clean(error?.message || error, 300),
        });
      }
    }
  }

  const callerInfo = validateCallerInfo(parsed);
  if (callerInfo.valid) {
    const fingerprint = stableFingerprint('save_caller_info', callerInfo.value);
    try {
      const saved = await handlers.saveCallerInfo?.(callerInfo.value);
      results.push(
        saved
          ? {
              action: 'save_caller_info',
              status: 'succeeded',
              fingerprint,
              name: saved.name || callerInfo.value.name || null,
              reason: saved.reason || callerInfo.value.reason || null,
              record: saved,
            }
          : {
              action: 'save_caller_info',
              status: 'failed',
              fingerprint,
              reason: 'The backend did not save caller information.',
            }
      );
    } catch (error) {
      results.push({
        action: 'save_caller_info',
        status: 'failed',
        fingerprint,
        reason: clean(error?.message || error, 300),
      });
    }
  }

  if (parsed?.escalate) {
    const validation = validateEscalation(parsed.escalate);
    const fingerprint = validation.valid
      ? stableFingerprint('escalate', validation.value)
      : null;
    if (!capabilities.escalate) {
      results.push({
        action: 'escalate',
        status: 'disabled',
        reason: 'Escalation is not available.',
      });
    } else if (!validation.valid) {
      results.push({ action: 'escalate', status: 'invalid', reason: validation.reason });
    } else if (completed.has(fingerprint)) {
      results.push({ action: 'escalate', status: 'duplicate', fingerprint });
    } else {
      try {
        const outcome = await handlers.escalate?.(validation.value);
        results.push(
          outcome?.ok
            ? {
                action: 'escalate',
                status: 'succeeded',
                fingerprint,
                channel: outcome.channel || null,
              }
            : {
                action: 'escalate',
                status: 'failed',
                fingerprint,
                reason: clean(outcome?.reason || 'No working handoff channel.', 300),
              }
        );
      } catch (error) {
        results.push({
          action: 'escalate',
          status: 'failed',
          fingerprint,
          reason: clean(error?.message || error, 300),
        });
      }
    }
  }

  const actionFailed = results.some(
    (result) =>
      result.action !== 'save_caller_info' &&
      ['failed', 'disabled', 'invalid'].includes(result.status)
  );
  return {
    results,
    shouldEndCall: Boolean(parsed?.shouldEndCall && capabilities.endCall && !actionFailed),
  };
}

function formatToolConfirmation(results = [], language = 'en') {
  const meaningful = results.find((result) =>
    ['create_service_request', 'escalate', 'tool_request'].includes(result.action)
  );
  if (!meaningful) return '';

  const sw = language === 'sw';
  const sheng = language === 'sheng';
  if (meaningful.action === 'tool_request') {
    if (sw) return 'Sijaweza kukamilisha hatua hiyo.';
    if (sheng) return 'Sijaweza ku-complete hiyo action.';
    return "I couldn't complete that action.";
  }
  if (meaningful.action === 'create_service_request') {
    if (meaningful.status === 'succeeded') {
      if (sw) return 'Sawa — nimehifadhi ombi lako.';
      if (sheng) return 'Poa — nime-save request yako.';
      return "Done — I've saved your request.";
    }
    if (meaningful.status === 'duplicate') {
      if (sw) return 'Ombi hilo tayari limehifadhiwa.';
      if (sheng) return 'Hiyo request tayari iko saved.';
      return 'That request is already saved.';
    }
    if (meaningful.status === 'invalid') {
      const missing = Array.isArray(meaningful.missingSlots)
        ? meaningful.missingSlots
        : [];
      if (missing.includes('when_text') || /when_text/i.test(meaningful.reason || '')) {
        if (sw) return 'Niambie jina lako na wakati utakapopita ndio nihifadhi hold.';
        if (sheng) return 'Niambie jina yako na when utapita ndio ni-save hold.';
        return 'Tell me your name and when you will pick up so I can save the hold.';
      }
      if (missing.includes('name') || /name/i.test(meaningful.reason || '')) {
        if (sw) return 'Niambie jina lako ndio nihifadhi ombi.';
        if (sheng) return 'Niambie jina yako ndio ni-save request.';
        return 'Tell me your name so I can save the request.';
      }
      if (sw) return 'Nahitaji kidogo zaidi kabla nihifadhi ombi.';
      if (sheng) return 'Nahitaji detail kidogo kabla ni-save request.';
      return 'I need a bit more detail before I can save that request.';
    }
    if (sw) return 'Sijaweza kuhifadhi ombi hilo sasa hivi.';
    if (sheng) return 'Sijaweza ku-save hiyo request saa hii.';
    return "I couldn't save that request right now.";
  }

  if (meaningful.status === 'succeeded') {
    if (sw) return 'Sawa — nimeituma kwa timu.';
    if (sheng) return 'Poa — nimeituma kwa team.';
    return "Done — I've sent it to the team.";
  }
  if (meaningful.status === 'duplicate') {
    if (sw) return 'Ombi hilo tayari lilitumwa.';
    if (sheng) return 'Hiyo request tayari ilitumwa.';
    return 'That request was already sent.';
  }
  if (sw) return 'Sijaweza kutuma ombi hilo sasa hivi.';
  if (sheng) return 'Sijaweza kutuma hiyo request saa hii.';
  return "I couldn't send that request right now.";
}

module.exports = {
  REQUEST_TYPES,
  stableFingerprint,
  validateServiceRequest,
  validateCallerInfo,
  validateEscalation,
  executeBrainTools,
  formatToolConfirmation,
};
