import type { InboxItem } from "@/lib/inboxPurpose";

export type PrototypeTurn = {
  speaker: "caller" | "receptionist";
  text: string;
};

function item(
  partial: Partial<InboxItem> & Pick<InboxItem, "id" | "purpose" | "headline">
): InboxItem {
  return {
    createdAt: "2026-09-17T05:10:00.000Z",
    needsYou: true,
    callerName: "Amina",
    callerPhone: "254700000001",
    contactId: null,
    detail: null,
    callId: partial.id,
    lead: null,
    hold: null,
    job: null,
    intent: null,
    urgent: false,
    ...partial,
  };
}

/** Populated home-services morning. Copy stays niche-neutral in chrome. */
export const PROTOTYPE_ITEMS: InboxItem[] = [
  item({
    id: "human-amina",
    purpose: "human",
    callerName: "Amina Njeri",
    callerPhone: "254700000001",
    headline: "Asked for the owner",
    detail: "Wants a person on the line.",
    intent: "human",
    urgent: true,
    createdAt: "2026-09-17T06:42:00.000Z",
  }),
  item({
    id: "job-otieno",
    purpose: "job",
    callerName: "Otieno Okoth",
    callerPhone: "254700000002",
    headline: "House cleaning",
    detail: "Tomorrow 9am. Kericho road.",
    intent: "book_visit",
    createdAt: "2026-09-17T06:18:00.000Z",
    job: {
      id: "job-1",
      created_at: "2026-09-17T06:18:00.000Z",
      service_name: "House cleaning",
      status: "requested",
      when_text: "Tomorrow 9am",
      address_landmark: "Kericho road",
      notes: "Two bathrooms",
      caller_name: "Otieno Okoth",
      caller_phone: "254700000002",
      call_id: "job-otieno",
    },
  }),
  item({
    id: "hold-wanjiku",
    purpose: "hold",
    callerName: "Wanjiku Kamau",
    callerPhone: "254700000003",
    headline: "5L bleach",
    detail: "Today 4pm pickup.",
    intent: "hold_or_pickup",
    createdAt: "2026-09-17T05:55:00.000Z",
    hold: {
      id: "hold-1",
      created_at: "2026-09-17T05:55:00.000Z",
      request_type: "hold_or_pickup",
      status: "open",
      item: "5L bleach",
      quantity: "1",
      when_text: "Today 4pm",
      notes: null,
      caller_name: "Wanjiku Kamau",
      caller_phone: "254700000003",
      call_id: "hold-wanjiku",
    },
  }),
  item({
    id: "missed-alvin",
    purpose: "missed",
    callerName: "Alvin Mutua",
    callerPhone: "254700000004",
    headline: "Missed. Line rang out.",
    intent: "callback",
    createdAt: "2026-09-17T05:12:00.000Z",
  }),
  item({
    id: "job-mercy",
    purpose: "job",
    callerName: "Mercy Achieng",
    callerPhone: "254700000005",
    headline: "Deep clean",
    detail: "Friday afternoon. Westlands.",
    intent: "book_visit",
    needsYou: false,
    createdAt: "2026-09-16T14:20:00.000Z",
    job: {
      id: "job-2",
      created_at: "2026-09-16T14:20:00.000Z",
      service_name: "Deep clean",
      status: "confirmed",
      when_text: "Friday 2pm",
      address_landmark: "Westlands",
      notes: null,
      caller_name: "Mercy Achieng",
      caller_phone: "254700000005",
      call_id: "job-mercy",
    },
  }),
  item({
    id: "answered-hours",
    purpose: "answered",
    callerName: "Brian Omondi",
    callerPhone: "254700000006",
    headline: "Asked Saturday hours",
    detail: "Receptionist answered. Closed.",
    intent: "hours_open",
    needsYou: false,
    createdAt: "2026-09-16T11:04:00.000Z",
  }),
  item({
    id: "hold-fatuma",
    purpose: "hold",
    callerName: "Fatuma Ali",
    callerPhone: "254700000007",
    headline: "20kg rice",
    detail: "Morning pickup.",
    intent: "hold_or_pickup",
    createdAt: "2026-09-16T08:40:00.000Z",
    hold: {
      id: "hold-2",
      created_at: "2026-09-16T08:40:00.000Z",
      request_type: "hold_or_pickup",
      status: "open",
      item: "20kg rice",
      quantity: "1",
      when_text: "Morning",
      notes: null,
      caller_name: "Fatuma Ali",
      caller_phone: "254700000007",
      call_id: "hold-fatuma",
    },
  }),
  item({
    id: "answered-price",
    purpose: "answered",
    callerName: "James Kariuki",
    callerPhone: "254700000008",
    headline: "Asked house cleaning price",
    intent: "price_band",
    needsYou: false,
    createdAt: "2026-09-15T16:10:00.000Z",
  }),
];

export const PROTOTYPE_TRANSCRIPTS: Record<string, PrototypeTurn[]> = {
  "human-amina": [
    { speaker: "receptionist", text: "Scalers Cleaning, this is Amina. How can I help?" },
    { speaker: "caller", text: "Can I speak to the owner please." },
    { speaker: "receptionist", text: "I will have them call you back. What is this about?" },
    { speaker: "caller", text: "The last visit left water on the floor." },
  ],
  "job-otieno": [
    { speaker: "receptionist", text: "Scalers Cleaning, how can I help?" },
    { speaker: "caller", text: "I need house cleaning tomorrow morning." },
    { speaker: "receptionist", text: "I can book 9am. Where should we come?" },
    { speaker: "caller", text: "Kericho road, near the petrol station. Two bathrooms." },
  ],
  "hold-wanjiku": [
    { speaker: "receptionist", text: "Hello, Scalers Shop." },
    { speaker: "caller", text: "Hold 5 litres of bleach. I will pass at 4." },
    { speaker: "receptionist", text: "Held. See you at 4pm." },
  ],
  "missed-alvin": [
    { speaker: "receptionist", text: "The line rang out. No speech captured." },
  ],
  "job-mercy": [
    { speaker: "caller", text: "Confirm Friday 2pm deep clean in Westlands." },
    { speaker: "receptionist", text: "Confirmed. We will be there Friday at 2." },
  ],
  "answered-hours": [
    { speaker: "caller", text: "Are you open Saturday?" },
    { speaker: "receptionist", text: "We are closed Saturday. Open Monday 8 to 5." },
  ],
  "hold-fatuma": [
    { speaker: "caller", text: "Please keep a 20 kilo bag of rice for morning." },
    { speaker: "receptionist", text: "Held for morning pickup." },
  ],
  "answered-price": [
    { speaker: "caller", text: "How much is house cleaning?" },
    { speaker: "receptionist", text: "From 3,500 shillings. It depends on rooms." },
  ],
};
