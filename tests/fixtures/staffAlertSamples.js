// Realistic staff call alerts per kind, built the way server.js builds them
// (events.js + templates.js), for the WhatsApp / email tests and previews.
const {
  ownerLeadEvent,
  serviceRequestEvent,
  appointmentEvent,
  renderEventText,
} = require('../../src/notifications/events');
const { escalationBody } = require('../../src/notifications/templates');

const BIZ = 'Mama Njeri Gas';
const PHONE = '+254712345678';
const CALL_ID = '3f2b9c1e-7a4d-4e8b-9c21-5d6e7f8a9b0c';
const REC = 'https://media.scalers.co.ke/rec/3f2b9c1e.mp3';

function requestSample(type, item, when, notes) {
  const request = { request_type: type, item, quantity: type === 'order' ? '2' : null, when_text: when, caller_name: 'Wanjiku Kamau', caller_phone: PHONE, notes };
  const event = serviceRequestEvent(request, BIZ);
  return {
    kind: 'service_request',
    body: renderEventText(event),
    lead: { businessName: BIZ, name: 'Wanjiku Kamau', reason: `${event.title}: ${[item, when].filter(Boolean).join('. ')}`, callerNumber: PHONE },
  };
}

function visitSample(kind, status, when) {
  const appointment = { service_name: 'Gas cooker installation', when_text: when, address_landmark: 'Kahawa West, near Quickmart', caller_name: 'Wanjiku Kamau', caller_phone: PHONE, notes: 'Bring a 2m hose', status };
  const event = appointmentEvent(appointment, BIZ, kind);
  return {
    kind: 'appointment',
    body: renderEventText(event),
    lead: { businessName: BIZ, name: 'Wanjiku Kamau', reason: `${event.title}: ${['Gas cooker installation', when].join('. ')}`, callerNumber: PHONE },
  };
}

function leadSample(kind, reason) {
  const call = { name: 'Wanjiku Kamau', reason, from_number: PHONE, recording_url: REC, callUrl: `https://app.scalers.co.ke/calls/${CALL_ID}` };
  const event = ownerLeadEvent(call, BIZ);
  return {
    kind,
    body: renderEventText(event),
    lead: { businessName: BIZ, name: 'Wanjiku Kamau', reason, callerNumber: PHONE, recordingUrl: REC },
  };
}

const SAMPLES = {
  lead: leadSample('lead', 'Wants 13kg gas refill to Kahawa West today, asked regulator price'),
  escalation: {
    kind: 'escalation',
    body: escalationBody({ businessName: BIZ, teammate: { name: 'Peter', role: 'Manager' }, callerName: 'Wanjiku Kamau', reason: 'Refund for a leaking 6kg cylinder bought Saturday', callerNumber: PHONE, recordingUrl: REC }),
    lead: { businessName: BIZ, name: 'Wanjiku Kamau', reason: 'Refund for a leaking 6kg cylinder bought Saturday', callerNumber: PHONE, recordingUrl: REC },
  },
  enquiry: requestSample('enquiry', '6kg and 13kg refill prices', null, 'Asked if you deliver to Ruiru'),
  hold: requestSample('hold', 'Two 13kg cylinders', 'Today 5pm', null),
  order: requestSample('order', '13kg refill', 'Tomorrow morning', 'Pay on delivery'),
  callbackRequest: requestSample('callback', 'Quote for a 50kg installation', 'After 5pm', null),
  visitRequest: visitSample('created', 'requested', 'Thursday 10am'),
  visitChanged: visitSample('updated', 'requested', 'Friday 10am'),
  visitCancelled: visitSample('updated', 'cancelled', 'Thursday 10am'),
  voicemail: leadSample('voicemail', 'Left a message about a gas smell after the last refill'),
  callback: leadSample('callback', 'Asked for a call back after 5pm about bulk prices'),
};

module.exports = { BIZ, CALL_ID, PHONE, REC, SAMPLES };
