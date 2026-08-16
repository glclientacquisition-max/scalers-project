#!/usr/bin/env node
// Home-services playbook scenario smoke (no network).

const {
  classifyHomeIntent,
  missingHomeSlots,
  canCompleteHomeIntent,
} = require('../src/conversation/playbooks/homeServices');
const { parseGeminiResponse } = require('../src/conversation/toolMarkers');
const {
  executeBrainTools,
  formatToolConfirmation,
} = require('../src/conversation/toolExecution');
const { defaultHoursSchedule } = require('../src/conversation/businessHours');

/** @type {Array<{ name: string, utter: string, intent: string, slots?: object, missing?: string[], complete?: boolean, toolRaw?: string }>} */
const scenarios = [
  {
    name: 'Hours ask',
    utter: 'Are you open on Saturday?',
    intent: 'hours_open',
    complete: true,
  },
  {
    name: 'Coverage ask',
    utter: 'Do you cover Kiambu?',
    intent: 'service_area',
    complete: true,
  },
  {
    name: 'Book incomplete without when/landmark',
    utter: 'Can you come fix my sink?',
    intent: 'book_visit',
    slots: { service: 'plumbing', name: 'Amina' },
    missing: ['when', 'landmark'],
    complete: false,
  },
  {
    name: 'Book complete',
    utter: 'Book a plumbing visit tomorrow at 3 near Sarit',
    intent: 'book_visit',
    slots: {
      service: 'plumbing',
      name: 'Amina',
      when: 'tomorrow 3pm',
      landmark: 'near Sarit',
    },
    missing: [],
    complete: true,
    toolRaw:
      '###TOOL###{"create_appointment":{"service_name":"Plumbing","name":"Amina","when_text":"tomorrow 3pm","landmark":"near Sarit"}}###ENDTOOL###',
  },
  {
    name: 'Cancel visit',
    utter: 'Please cancel my appointment',
    intent: 'cancel',
    complete: true,
    toolRaw: '###TOOL###{"update_appointment":{"status":"cancelled"}}###ENDTOOL###',
  },
  {
    name: 'Emergency',
    utter: 'Emergency — burst pipe flooding the kitchen',
    intent: 'emergency',
    slots: {},
    missing: ['name', 'reason'],
    complete: false,
  },
];

let failed = 0;
for (const s of scenarios) {
  const intent = classifyHomeIntent(s.utter);
  const missing = missingHomeSlots(intent, s.slots || {});
  const complete = canCompleteHomeIntent(intent, s.slots || {});
  const okIntent = intent === s.intent;
  const okMissing =
    !s.missing ||
    JSON.stringify(missing) === JSON.stringify(s.missing);
  const okComplete = s.complete == null || complete === s.complete;
  let okTool = true;
  if (s.toolRaw) {
    const parsed = parseGeminiResponse(s.toolRaw);
    if (s.toolRaw.includes('create_appointment')) {
      okTool = Boolean(parsed.appointment?.serviceName);
    } else if (s.toolRaw.includes('update_appointment')) {
      okTool = Boolean(parsed.appointmentUpdate?.status);
    }
  }
  const pass = okIntent && okMissing && okComplete && okTool;
  console.log(`${pass ? '✓' : '✗'} ${s.name}`);
  if (!pass) {
    failed += 1;
    console.log({ intent, missing, complete, okTool });
  }
}

if (failed) {
  console.error(`\n${failed} scenario(s) failed`);
  process.exit(1);
}
console.log(`\n${scenarios.length} home-services scenarios passed`);

const hoursSchedule = defaultHoursSchedule();
const nowTue11Eat = new Date(Date.UTC(2026, 7, 18, 8, 0, 0));
const capabilities = {
  createAppointment: true,
  updateAppointment: true,
  createServiceRequest: true,
  saveCallerInfo: true,
  escalate: true,
  endCall: true,
};

async function smokeHours() {
  let sundayInserts = 0;
  const sunday = await executeBrainTools({
    parsed: parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Plumbing","name":"Amina","when_text":"Sunday 9 PM","landmark":"Westlands"}}###ENDTOOL###'
    ),
    capabilities,
    hoursSchedule,
    now: nowTue11Eat,
    handlers: {
      createAppointment: async () => {
        sundayInserts += 1;
        return { id: 'nope', status: 'requested' };
      },
    },
  });
  const sundaySpoken = formatToolConfirmation(sunday.results, 'en');
  const sundayOk =
    sundayInserts === 0 &&
    sunday.results[0]?.code === 'closed_day' &&
    !/done/i.test(sundaySpoken) &&
    !/logged your visit request/i.test(sundaySpoken);
  console.log(`${sundayOk ? '✓' : '✗'} Hours smoke: Sunday 21:00 not persisted`);
  if (!sundayOk) {
    console.log({ sundayInserts, result: sunday.results[0], sundaySpoken });
    process.exit(1);
  }

  const tuePayloads = [];
  const tuesday = await executeBrainTools({
    parsed: parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Plumbing","name":"Amina","when_text":"Tuesday 10 AM","landmark":"Westlands"}}###ENDTOOL###'
    ),
    capabilities,
    hoursSchedule,
    now: nowTue11Eat,
    handlers: {
      createAppointment: async (appointment) => {
        tuePayloads.push(appointment);
        return {
          id: 'appt_ok',
          service_name: appointment.serviceName,
          status: 'requested',
        };
      },
    },
  });
  const tueSpoken = formatToolConfirmation(tuesday.results, 'en');
  const tueOk =
    tuePayloads.length === 1 &&
    tuesday.results[0]?.status === 'succeeded' &&
    tuesday.results[0]?.record?.status === 'requested' &&
    /logged your visit request/i.test(tueSpoken) &&
    !/done/i.test(tueSpoken) &&
    !/confirmed/i.test(tueSpoken);
  console.log(`${tueOk ? '✓' : '✗'} Hours smoke: Tuesday 10:00 persisted as requested`);
  if (!tueOk) {
    console.log({ tuePayloads, result: tuesday.results[0], tueSpoken });
    process.exit(1);
  }
}

smokeHours().catch((err) => {
  console.error(err);
  process.exit(1);
});
