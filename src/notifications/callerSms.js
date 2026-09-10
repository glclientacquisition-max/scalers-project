// Caller SMS (business → the person who called).
// Off unless tenants.notify_channels.caller_sms is true.

const { sendSms, isSmsConfigured, normalizeSmsTo } = require('./sms');
const { EVENTS, renderCallerText, displayOwnerCallerName } = require('./events');
const { parseNotifyChannels } = require('./notifyChannels');

function callerSmsEnabled(channels) {
  return parseNotifyChannels(channels).caller_sms === true;
}

function appointmentCallerEvent(appointment, kind = 'created') {
  const status = String(appointment?.status || 'requested').toLowerCase();
  let eventKind = EVENTS.CALLER_APPOINTMENT;
  if (kind === 'updated' && status === 'cancelled') {
    eventKind = EVENTS.CALLER_APPOINTMENT_CANCELLED;
  } else if (kind === 'updated' && status === 'confirmed') {
    eventKind = EVENTS.CALLER_APPOINTMENT_CONFIRMED;
  } else if (kind === 'updated') {
    eventKind = EVENTS.CALLER_APPOINTMENT_RESCHEDULED;
  }
  return {
    kind: eventKind,
    businessName: appointment?.businessName,
    when: appointment?.when_text,
    item: appointment?.service_name,
    caller: {
      name: displayOwnerCallerName(appointment?.caller_name),
      phone: appointment?.caller_phone,
    },
  };
}

function requestCallerEvent(request) {
  const type = String(request?.request_type || '').toLowerCase();
  if (type === 'enquiry') return null;
  if (type === 'callback') {
    return {
      kind: EVENTS.CALLER_CALLBACK,
      businessName: request.businessName,
      caller: {
        name: displayOwnerCallerName(request.caller_name),
        phone: request.caller_phone,
      },
    };
  }
  if (type === 'order') {
    return {
      kind: EVENTS.CALLER_ORDER,
      businessName: request.businessName,
      item: request.item,
      caller: {
        name: displayOwnerCallerName(request.caller_name),
        phone: request.caller_phone,
      },
    };
  }
  if (type === 'hold') {
    return {
      kind: EVENTS.CALLER_HOLD,
      businessName: request.businessName,
      item: request.item,
      caller: {
        name: displayOwnerCallerName(request.caller_name),
        phone: request.caller_phone,
      },
    };
  }
  return null;
}

/**
 * @param {{ to?: string, event?: object, channels?: object }} opts
 */
async function dispatchCallerSms({ to, event, channels } = {}) {
  if (!callerSmsEnabled(channels)) {
    return { channel: null, reason: 'caller_sms_off' };
  }
  if (!event) return { channel: null, reason: 'no_event' };
  if (!isSmsConfigured()) {
    return { channel: null, reason: 'sms_not_configured' };
  }
  const dest = normalizeSmsTo(to || event.caller?.phone);
  if (!dest) return { channel: null, reason: 'no_caller_phone' };
  const body = renderCallerText(event);
  const result = await sendSms({ to: dest, body });
  return { channel: 'sms', to: dest, result, body };
}

module.exports = {
  callerSmsEnabled,
  appointmentCallerEvent,
  requestCallerEvent,
  dispatchCallerSms,
};
