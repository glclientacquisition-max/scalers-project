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
  {
    name: 'Urgent Airbnb is a visit',
    utter: 'Urgent Airbnb clean tomorrow in Runda',
    intent: 'book_visit',
    slots: {
      service: 'airbnb clean',
      name: 'Alvin',
      when: 'tomorrow 8am',
      landmark: 'Runda',
    },
    missing: [],
    complete: true,
    toolRaw:
      '###TOOL###{"create_appointment":{"service_name":"Home cleaning","name":"Alvin","when_text":"tomorrow 8am","landmark":"Runda"}}###ENDTOOL###',
  },
  {
    name: 'Carpet clean is a visit',
    utter: 'I need my carpet cleaned tomorrow',
    intent: 'book_visit',
    complete: false,
    missing: ['service', 'name', 'when', 'landmark'],
  },
  {
    name: 'Mattress price band',
    utter: 'How much for mattress cleaning?',
    intent: 'price_band',
    slots: { service: 'mattress' },
    missing: [],
    complete: true,
  },
  {
    name: 'Reschedule visit',
    utter: 'Please reschedule my visit to Friday 2pm',
    intent: 'reschedule',
    slots: { when: 'Friday 2pm' },
    missing: [],
    complete: true,
    toolRaw:
      '###TOOL###{"update_appointment":{"when_text":"Friday 2pm"}}###ENDTOOL###',
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
      okTool = Boolean(
        parsed.appointmentUpdate?.status || parsed.appointmentUpdate?.whenText
      );
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
    !/saved your visit request/i.test(sundaySpoken);
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
    /saved your visit request/i.test(tueSpoken) &&
    !/done/i.test(tueSpoken) &&
    !/confirmed/i.test(tueSpoken);
  console.log(`${tueOk ? '✓' : '✗'} Hours smoke: Tuesday 10:00 persisted as requested`);
  if (!tueOk) {
    console.log({ tuePayloads, result: tuesday.results[0], tueSpoken });
    process.exit(1);
  }

  const parallelPayloads = [];
  const parallel = await executeBrainTools({
    parsed: parseGeminiResponse(
      '###TOOL###{"create_appointment":{"service_name":"Home cleaning","name":"Shy","when_text":"Tuesday 10 AM","landmark":"Runda"}}###ENDTOOL###'
    ),
    capabilities,
    hoursSchedule,
    now: nowTue11Eat,
    openAppointments: [
      {
        service_name: 'Plumbing',
        when_text: 'Tuesday 10 AM',
        window_start: '2026-08-18T07:00:00.000Z',
        status: 'requested',
      },
    ],
    handlers: {
      createAppointment: async (appointment) => {
        parallelPayloads.push(appointment);
        return {
          id: 'appt_parallel',
          service_name: appointment.serviceName,
          status: 'requested',
        };
      },
    },
  });
  const parallelOk =
    parallelPayloads.length === 1 &&
    parallel.results[0]?.status === 'succeeded' &&
    parallel.results[0]?.code !== 'overlap';
  console.log(`${parallelOk ? '✓' : '✗'} Hours smoke: same-hour second visit persisted`);
  if (!parallelOk) {
    console.log({ parallelPayloads, result: parallel.results[0] });
    process.exit(1);
  }
}

smokeHours().catch((err) => {
  console.error(err);
  process.exit(1);
});
