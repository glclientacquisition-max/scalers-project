// Validate and execute model-proposed actions, returning backend-confirmed outcomes.

const { findProductMatch, normalizeProducts } = require('./productCatalog');
const {
  evaluateAppointmentHours,
  formatRequestedWhenLabel,
} = require('./appointmentHours');

const REQUEST_TYPES = new Set(['hold', 'enquiry', 'order', 'callback', 'other']);

/** Names that must never be persisted as the caller (STT / model mix-ups). */
const RESERVED_CALLER_NAMES = new Set([
  'unknown',
  'caller',
  'customer',
  'client',
  'guest',
  'user',
  'test',
  'testing',
  'n/a',
  'na',
  'none',
  'receptionist',
  'agent',
  'assistant',
  'ai',
  'bot',
]);

function clean(value, max = 240) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeNameKey(value) {
  return clean(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the proposed caller name is the agent, business, or a reserved placeholder.
 * Live beta failure: orders/enquiries saved with name "Aisha" (the agent).
 */
function isReservedCallerName(name, { agentName = '', businessName = '' } = {}) {
  const key = normalizeNameKey(name);
  if (!key || key.length < 2) return true;
  if (RESERVED_CALLER_NAMES.has(key)) return true;

  const agentKey = normalizeNameKey(agentName);
  if (agentKey && (key === agentKey || key.includes(agentKey) || agentKey.includes(key))) {
    // Avoid blocking short substrings like "a" — require meaningful overlap.
    if (agentKey.length >= 2 && key.length >= 2) {
      if (key === agentKey) return true;
      // "Aisha speaking" / "this is Aisha"
      if (key.startsWith(`${agentKey} `) || key.endsWith(` ${agentKey}`)) return true;
    }
  }

  const businessKey = normalizeNameKey(businessName);
  if (businessKey && key === businessKey) return true;
  // "ChapterOne" / "Chapter One Bookstore" first token collisions
  const businessToken = businessKey.split(/\s+/)[0] || '';
  if (businessToken.length >= 4 && key === businessToken) return true;

  return false;
}

/**
 * STT often emits a spoken sentence instead of a title ("I have to make habits").
 * Those must not become hold/order items even if catalogue grounding is unavailable.
 */
function looksLikeUnclearTitle(item) {
  const text = clean(item, 200);
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;
  const lower = text.toLowerCase();
  if (
    /^(i |i'd |i have |i want |i need |my name|uh,? |um,? |please |can you |do you )/i.test(
      lower
    )
  ) {
    return true;
  }
  // Trailing mid-thought / fragment punctuation from STT
  if (/[—–-]\s*$/.test(text) || /,(and|but)\.?$/i.test(text)) return true;
  return false;
}

function rejectBadCallerName(value, identity) {
  if (!value.name) return null;
  if (!isReservedCallerName(value.name, identity)) return null;
  return {
    valid: false,
    reason: 'Need the caller\'s real name — not the agent or a placeholder.',
    missingSlots: ['name'],
    code: 'bad_caller_name',
    value,
  };
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

/**
 * Identity for hold dedupe/refine: same caller+item = one hold per call,
 * even when when_text gets more specific (Tomorrow → Tomorrow at 5 PM).
 */
function requestIdentityFingerprint(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'hold') {
    return stableFingerprint('create_service_request', {
      type: value.type,
      name: value.name,
      item: value.item,
      phone: value.phone,
    });
  }
  return stableFingerprint('create_service_request', value);
}

function findPriorHold(priorHolds, identity) {
  if (!identity || !Array.isArray(priorHolds)) return null;
  return (
    priorHolds.find(
      (row) =>
        row &&
        row.identity === identity &&
        (row.id || row.status === 'succeeded')
    ) || null
  );
}

function whenTextIsRefinement(previous, next) {
  const a = clean(previous).toLowerCase();
  const b = clean(next).toLowerCase();
  if (!a || !b) return Boolean(b && b !== a);
  if (a === b) return false;
  return b.includes(a) || a.includes(b) || true;
}

function validateServiceRequest(
  raw,
  { productCatalog, agentName = '', businessName = '' } = {}
) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'Missing service request payload.' };
  }
  const typeRaw = clean(raw.type || 'enquiry', 40).toLowerCase();
  // Accept retail playbook alias; persist as hold.
  const type =
    typeRaw === 'hold_or_pickup'
      ? 'hold'
      : REQUEST_TYPES.has(typeRaw)
        ? typeRaw
        : 'enquiry';
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

  const identity = { agentName, businessName };
  const badName = rejectBadCallerName(value, identity);
  if (badName) return badName;

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
    if (looksLikeUnclearTitle(value.item)) {
      return {
        valid: false,
        reason:
          'Hold needs a clear catalogue title — confirm the exact book name first.',
        missingSlots: ['catalog_item'],
        code: 'title_unclear',
        value,
      };
    }
    const catalog = normalizeProducts(productCatalog);
    if (!catalog.length) {
      return {
        valid: false,
        reason:
          'Holds require a loaded product catalogue — log an enquiry instead.',
        missingSlots: ['catalog_item'],
        code: 'catalog_required',
        value,
      };
    }
    const match = findProductMatch(value.item, catalog);
    if (!match) {
      return {
        valid: false,
        reason:
          'That title is not in the grounded catalogue — log an enquiry or special-order quote instead of a hold.',
        missingSlots: ['catalog_item'],
        code: 'catalog_miss',
        value,
      };
    }
    value.item = clean(match.product.name, 200);
  }
  // Orders: require product + name, clear title, and catalogue ground.
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
    if (looksLikeUnclearTitle(value.item)) {
      return {
        valid: false,
        reason:
          'Order needs a clear catalogue title — confirm the exact book name first.',
        missingSlots: ['catalog_item'],
        code: 'title_unclear',
        value,
      };
    }
    const catalog = normalizeProducts(productCatalog);
    if (!catalog.length) {
      return {
        valid: false,
        reason:
          'Orders require a loaded product catalogue — log an enquiry or quote instead.',
        missingSlots: ['catalog_item'],
        code: 'catalog_required',
        value,
      };
    }
    const match = findProductMatch(value.item, catalog);
    if (!match) {
      return {
        valid: false,
        reason:
          'That title is not in the grounded catalogue — log an enquiry or special-order quote instead of an order.',
        missingSlots: ['catalog_item'],
        code: 'catalog_miss',
        value,
      };
    }
    value.item = clean(match.product.name, 200);
  }
  return { valid: true, value };
}

function validateCallerInfo(parsed, { agentName = '', businessName = '' } = {}) {
  const value = {
    name: clean(parsed?.name, 120),
    reason: clean(parsed?.reason, 400),
  };
  if (value.name && isReservedCallerName(value.name, { agentName, businessName })) {
    // Keep reason-only capture; drop the bad name so we don't poison the lead.
    value.name = '';
  }
  return {
    valid: Boolean(value.name || value.reason),
    value,
    reason: value.name || value.reason ? '' : 'No caller information supplied.',
  };
}

function validateEscalation(raw, { agentName = '', businessName = '' } = {}) {
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
  if (!value.name) {
    return {
      valid: false,
      reason: 'Escalation needs the caller name before notifying the team.',
      missingSlots: ['name'],
    };
  }
  if (isReservedCallerName(value.name, { agentName, businessName })) {
    return {
      valid: false,
      reason: 'Escalation needs the caller\'s real name — not the agent or a placeholder.',
      missingSlots: ['name'],
      code: 'bad_caller_name',
    };
  }
  if (!value.teammate) {
    value.teammate = 'General queries';
  }
  return { valid: true, value };
}

function validateCreateAppointment(raw, { hoursSchedule = null, now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'Missing appointment payload.' };
  }
  const value = {
    serviceName: clean(raw.serviceName || raw.service_name || raw.service, 200),
    name: clean(raw.name, 120),
    phone: clean(raw.phone, 40),
    whenText: clean(raw.whenText || raw.when_text || raw.when, 160),
    landmark: clean(
      raw.landmark || raw.address_landmark || raw.address,
      240
    ),
    notes: clean(raw.notes, 400),
    windowStart: clean(raw.windowStart || raw.window_start, 64),
    windowEnd: clean(raw.windowEnd || raw.window_end, 64),
  };
  const missing = [];
  if (!value.serviceName) missing.push('service');
  if (!value.name) missing.push('name');
  if (!value.whenText) missing.push('when_text');
  if (!value.landmark) missing.push('landmark');
  if (missing.length) {
    return {
      valid: false,
      reason: `Visit booking needs ${missing.join(', ')} before saving.`,
      missingSlots: missing,
      value,
    };
  }
  const hours = evaluateAppointmentHours({
    whenText: value.whenText,
    schedule: hoursSchedule,
    now,
  });
  if (!hours.valid) {
    return {
      valid: false,
      reason: hours.code,
      code: hours.code,
      missingSlots: ['when_text'],
      hours,
      value,
    };
  }
  return { valid: true, value, hours };
}

const APPOINTMENT_UPDATE_STATUSES = new Set([
  'requested',
  'confirmed',
  'cancelled',
  'done',
]);

function validateUpdateAppointment(raw) {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, reason: 'Missing appointment update payload.' };
  }
  const statusRaw = clean(raw.status, 40).toLowerCase();
  const value = {
    appointmentId: clean(raw.appointmentId || raw.id || raw.appointment_id, 80),
    status: APPOINTMENT_UPDATE_STATUSES.has(statusRaw) ? statusRaw : '',
    whenText: clean(raw.whenText || raw.when_text || raw.when, 160),
    landmark: clean(
      raw.landmark || raw.address_landmark || raw.address,
      240
    ),
    notes: clean(raw.notes, 400),
    serviceName: clean(raw.serviceName || raw.service_name || raw.service, 200),
    phone: clean(raw.phone, 40),
    windowStart: clean(raw.windowStart || raw.window_start, 64),
    windowEnd: clean(raw.windowEnd || raw.window_end, 64),
  };
  if (!value.status && !value.whenText && !value.landmark && !value.notes) {
    return {
      valid: false,
      reason: 'Appointment update needs a status, new time, or note.',
      missingSlots: ['status'],
      value,
    };
  }
  return { valid: true, value };
}

async function executeBrainTools({
  parsed,
  capabilities = {},
  handlers = {},
  completedFingerprints = [],
  priorHolds = [],
  productCatalog = null,
  agentName = '',
  businessName = '',
  hoursSchedule = null,
  now = new Date(),
} = {}) {
  const completed = new Set(completedFingerprints);
  const results = [];
  const identityOpts = { productCatalog, agentName, businessName };

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
    const validation = validateServiceRequest(parsed.serviceRequest, identityOpts);
    const fingerprint = validation.valid
      ? stableFingerprint('create_service_request', validation.value)
      : null;
    const identity = validation.valid
      ? requestIdentityFingerprint(validation.value)
      : null;
    const priorHold =
      validation.valid && validation.value.type === 'hold'
        ? findPriorHold(priorHolds, identity)
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
        code: validation.code || null,
      });
    } else if (completed.has(fingerprint)) {
      results.push({
        action: 'create_service_request',
        status: 'duplicate',
        fingerprint,
        identity,
      });
    } else if (
      priorHold &&
      validation.value.type === 'hold' &&
      whenTextIsRefinement(priorHold.whenText, validation.value.whenText)
    ) {
      try {
        const updated = await handlers.updateServiceRequest?.({
          id: priorHold.id,
          ...validation.value,
        });
        if (updated) {
          results.push({
            action: 'create_service_request',
            status: 'updated',
            fingerprint,
            identity,
            id: updated.id || priorHold.id,
            requestType: updated.request_type || validation.value.type,
            value: validation.value,
            record: updated,
          });
        } else if (priorHold.id && !handlers.updateServiceRequest) {
          // No updater available — treat refined when_text as duplicate of the open hold.
          results.push({
            action: 'create_service_request',
            status: 'duplicate',
            fingerprint: identity,
            identity,
            reason: 'Hold already saved; pickup time refinement was noted.',
          });
        } else {
          results.push({
            action: 'create_service_request',
            status: 'duplicate',
            fingerprint: identity,
            identity,
            reason: 'Hold already saved for this title.',
          });
        }
      } catch (error) {
        results.push({
          action: 'create_service_request',
          status: 'failed',
          fingerprint,
          identity,
          reason: clean(error?.message || error, 300),
        });
      }
    } else if (priorHold && validation.value.type === 'hold') {
      results.push({
        action: 'create_service_request',
        status: 'duplicate',
        fingerprint: identity,
        identity,
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
                identity,
                id: created.id || null,
                requestType: created.request_type || validation.value.type,
                value: validation.value,
                record: created,
              }
            : {
                action: 'create_service_request',
                status: 'failed',
                fingerprint,
                identity,
                reason: 'The backend did not create a request.',
              }
        );
      } catch (error) {
        results.push({
          action: 'create_service_request',
          status: 'failed',
          fingerprint,
          identity,
          reason: clean(error?.message || error, 300),
        });
      }
    }
  }

  if (parsed?.appointment) {
    const validation = validateCreateAppointment(parsed.appointment, {
      hoursSchedule,
      now,
    });
    const fingerprint = validation.valid
      ? stableFingerprint('create_appointment', validation.value)
      : null;
    if (!capabilities.createAppointment) {
      results.push({
        action: 'create_appointment',
        status: 'disabled',
        reason: 'Appointment booking is not available.',
      });
    } else if (!validation.valid) {
      results.push({
        action: 'create_appointment',
        status: 'invalid',
        reason: validation.reason,
        code: validation.code || null,
        missingSlots: validation.missingSlots || [],
        hours: validation.hours || null,
        value: validation.value || null,
      });
    } else if (completed.has(fingerprint)) {
      results.push({
        action: 'create_appointment',
        status: 'duplicate',
        fingerprint,
      });
    } else {
      try {
        const created = await handlers.createAppointment?.(validation.value);
        results.push(
          created
            ? {
                action: 'create_appointment',
                status: 'succeeded',
                fingerprint,
                id: created.id || null,
                value: validation.value,
                hours: validation.hours || null,
                record: created,
              }
            : {
                action: 'create_appointment',
                status: 'failed',
                fingerprint,
                reason: 'The backend did not create an appointment.',
              }
        );
      } catch (error) {
        results.push({
          action: 'create_appointment',
          status: 'failed',
          fingerprint,
          reason: clean(error?.message || error, 300),
        });
      }
    }
  }

  if (parsed?.appointmentUpdate) {
    const validation = validateUpdateAppointment(parsed.appointmentUpdate);
    const fingerprint = validation.valid
      ? stableFingerprint('update_appointment', validation.value)
      : null;
    if (!capabilities.updateAppointment) {
      results.push({
        action: 'update_appointment',
        status: 'disabled',
        reason: 'Appointment updates are not available.',
      });
    } else if (!validation.valid) {
      results.push({
        action: 'update_appointment',
        status: 'invalid',
        reason: validation.reason,
        missingSlots: validation.missingSlots || [],
      });
    } else if (completed.has(fingerprint)) {
      results.push({
        action: 'update_appointment',
        status: 'duplicate',
        fingerprint,
      });
    } else {
      try {
        const updated = await handlers.updateAppointment?.(validation.value);
        results.push(
          updated
            ? {
                action: 'update_appointment',
                status: 'succeeded',
                fingerprint,
                id: updated.id || null,
                appointmentStatus: updated.status || validation.value.status,
                value: validation.value,
                record: updated,
              }
            : {
                action: 'update_appointment',
                status: 'failed',
                fingerprint,
                reason: 'No matching open appointment was found to update.',
              }
        );
      } catch (error) {
        results.push({
          action: 'update_appointment',
          status: 'failed',
          fingerprint,
          reason: clean(error?.message || error, 300),
        });
      }
    }
  }

  const callerInfo = validateCallerInfo(parsed, { agentName, businessName });
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
    const validation = validateEscalation(parsed.escalate, {
      agentName,
      businessName,
    });
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
      results.push({
        action: 'escalate',
        status: 'invalid',
        reason: validation.reason,
        missingSlots: validation.missingSlots || [],
        code: validation.code || null,
      });
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
                soft: Boolean(outcome.soft),
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
    [
      'create_appointment',
      'update_appointment',
      'create_service_request',
      'escalate',
      'tool_request',
    ].includes(result.action)
  );
  if (!meaningful) return '';

  const sw = language === 'sw';
  const sheng = language === 'sheng';
  if (meaningful.action === 'tool_request') {
    if (sw) return 'Sijaweza kukamilisha hatua hiyo.';
    if (sheng) return 'Sijaweza ku-complete hiyo action.';
    return "I couldn't complete that action.";
  }
  if (meaningful.action === 'create_appointment') {
    if (meaningful.status === 'succeeded') {
      const whenLabel = formatRequestedWhenLabel(meaningful.hours);
      if (sw) {
        return whenLabel
          ? `Sawa — nimehifadhi ombi la ziara ${whenLabel}.`
          : 'Sawa — nimehifadhi ombi la ziara.';
      }
      if (sheng) {
        return whenLabel
          ? `Poa — nime-save visit request ${whenLabel}.`
          : 'Poa — nime-save visit request.';
      }
      return whenLabel
        ? `I've logged your visit request for ${whenLabel}.`
        : "I've logged your visit request.";
    }
    if (meaningful.status === 'duplicate') {
      if (sw) return 'Ombi la ziara tayari limehifadhiwa.';
      if (sheng) return 'Hiyo visit request tayari iko saved.';
      return 'That visit request is already saved.';
    }
    if (meaningful.status === 'invalid') {
      const code = String(meaningful.code || '');
      const hours = meaningful.hours || {};
      if (code === 'closed_day') {
        const closedDay = hours.weekdayLong || 'that day';
        const next = hours.nextOpen?.label;
        if (sw) {
          return next
            ? `Tuko closed siku ya ${closedDay}. ${next} ingefaa?`
            : `Tuko closed siku ya ${closedDay}. Niambie siku ya kazi.`;
        }
        if (sheng) {
          return next
            ? `Tuko closed ${closedDay}. ${next} ingework?`
            : `Tuko closed ${closedDay}. Niambie siku ya kazi.`;
        }
        return next
          ? `We're closed on ${closedDay}s. Would ${next} during business hours work?`
          : `We're closed on ${closedDay}s. What day during business hours works?`;
      }
      if (code === 'outside_hours') {
        const until = hours.closeLabel || 'close';
        if (sw) {
          return `Tuko open hadi ${until}. Huo muda uko nje ya masaa. Ungependa muda kabla ya ${until}?`;
        }
        if (sheng) {
          return `Tuko open hadi ${until}. Hiyo time iko nje ya hours. Time kabla ya ${until}?`;
        }
        return `We're open until ${until}. That time is outside our hours. Would you like a time before ${until}?`;
      }
      if (code === 'currently_closed') {
        if (sw) {
          return 'Tuko closed sasa. Naweza kuchukua ombi la ziara wakati wa kazi.';
        }
        if (sheng) {
          return 'Tuko closed saa hii. Naweza take visit request wakati wa normal hours.';
        }
        return "We're closed right now. I can still take a visit during normal business hours.";
      }
      if (code === 'unparsed_when') {
        if (sw) return 'Niambie siku na saa unayopendelea.';
        if (sheng) return 'Niambie day na time unataka.';
        return 'What day and time would you prefer?';
      }
      const missing = Array.isArray(meaningful.missingSlots)
        ? meaningful.missingSlots
        : [];
      if (missing.includes('landmark') || missing.includes('when_text')) {
        if (sw) {
          return 'Niambie jina, huduma, wakati, na landmark ndio nihifadhi ziara.';
        }
        if (sheng) {
          return 'Niambie jina, service, when, na landmark ndio ni-save visit.';
        }
        return 'Tell me your name, the service, when, and a landmark so I can book the visit.';
      }
      if (missing.includes('name') || missing.includes('service')) {
        if (sw) return 'Niambie jina lako na huduma unayohitaji.';
        if (sheng) return 'Niambie jina yako na service unahitaji.';
        return 'Tell me your name and which service you need.';
      }
      if (sw) return 'Nahitaji kidogo zaidi kabla nihifadhi ziara.';
      if (sheng) return 'Nahitaji detail kidogo kabla ni-save visit.';
      return 'I need a bit more detail before I can book that visit.';
    }
    if (sw) return 'Sijaweza kuhifadhi ziara sasa hivi.';
    if (sheng) return 'Sijaweza ku-save hiyo visit saa hii.';
    return "I couldn't save that visit request right now.";
  }
  if (meaningful.action === 'update_appointment') {
    if (meaningful.status === 'succeeded') {
      const st = String(meaningful.appointmentStatus || '').toLowerCase();
      if (st === 'cancelled') {
        if (sw) return 'Sawa — nimeghairi ziara hiyo.';
        if (sheng) return 'Poa — nime-cancel hiyo visit.';
        return "Done — I've cancelled that visit.";
      }
      if (sw) return 'Sawa — nimebadilisha ratiba ya ziara.';
      if (sheng) return 'Poa — nime-update visit schedule.';
      return "Done — I've updated that visit.";
    }
    if (meaningful.status === 'duplicate') {
      if (sw) return 'Badiliko hilo tayari limetumwa.';
      if (sheng) return 'Hiyo update tayari ilitumwa.';
      return 'That visit update was already saved.';
    }
    if (meaningful.status === 'invalid') {
      if (sw) return 'Niambie muda mpya au kama unataka kughairi.';
      if (sheng) return 'Niambie new time au kama unataka cancel.';
      return 'Tell me the new time, or say if you want to cancel.';
    }
    if (sw) return 'Sijaweza kupata ziara ya kubadilisha sasa hivi.';
    if (sheng) return 'Sijaweza find visit ya ku-update saa hii.';
    return "I couldn't find an open visit to update right now.";
  }
  if (meaningful.action === 'create_service_request') {
    if (meaningful.status === 'succeeded' || meaningful.status === 'updated') {
      if (meaningful.status === 'updated') {
        if (sw) return 'Sawa — nimesasisha hold yako.';
        if (sheng) return 'Poa — nime-update hold yako.';
        return "Done — I've updated your hold.";
      }
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
      if (
        meaningful.code === 'catalog_miss' ||
        meaningful.code === 'catalog_required' ||
        meaningful.code === 'title_unclear' ||
        missing.includes('catalog_item')
      ) {
        if (meaningful.code === 'title_unclear') {
          if (sw) return 'Tafadhali sema jina kamili la kitabu ndio nihifadhi.';
          if (sheng) return 'Please confirm exact title ya kitabu ndio ni-save.';
          return 'Please confirm the exact book title so I can save that.';
        }
        if (sw) {
          return 'Sina hiyo kwenye orodha ya sasa — naweza kuhifadhi ombi la quotation badala yake.';
        }
        if (sheng) {
          return 'Siko na hiyo kwa catalogue sasa — naweza save enquiry/quote badala yake.';
        }
        return "I don't see that title in our current catalogue — I can log an enquiry or quote request instead.";
      }
      if (missing.includes('when_text') || /when_text/i.test(meaningful.reason || '')) {
        if (sw) return 'Niambie jina lako na wakati utakapopita ndio nihifadhi hold.';
        if (sheng) return 'Niambie jina yako na when utapita ndio ni-save hold.';
        return 'Tell me your name and when you will pick up so I can save the hold.';
      }
      if (
        meaningful.code === 'bad_caller_name' ||
        missing.includes('name') ||
        /name/i.test(meaningful.reason || '')
      ) {
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
    if (meaningful.soft) {
      if (sw) return 'Sawa — nimewaandikia timu; watakufuatilia.';
      if (sheng) return 'Poa — nime-note kwa team; watakufuatilia.';
      return "Done — I've noted that for the team to follow up.";
    }
    const channel = String(meaningful.channel || '').toLowerCase();
    if (/\bsms\b/.test(channel)) {
      if (sw) return 'Sawa — nimewatumia SMS timu.';
      if (sheng) return 'Poa — nime-SMS team.';
      return "Done — I've texted the team.";
    }
    if (sw) return 'Sawa — nimeituma kwa timu.';
    if (sheng) return 'Poa — nimeituma kwa team.';
    return "Done — I've sent it to the team.";
  }
  if (meaningful.status === 'invalid') {
    const missing = Array.isArray(meaningful.missingSlots)
      ? meaningful.missingSlots
      : [];
    if (missing.includes('name') || /name/i.test(meaningful.reason || '')) {
      if (sw) return 'Niambie jina lako ndio niwasiliane na timu.';
      if (sheng) return 'Niambie jina yako ndio ni-reach team.';
      return 'Tell me your name so I can reach the team for you.';
    }
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
  RESERVED_CALLER_NAMES,
  stableFingerprint,
  requestIdentityFingerprint,
  findPriorHold,
  whenTextIsRefinement,
  isReservedCallerName,
  looksLikeUnclearTitle,
  validateServiceRequest,
  validateCallerInfo,
  validateEscalation,
  validateCreateAppointment,
  validateUpdateAppointment,
  executeBrainTools,
  formatToolConfirmation,
};
