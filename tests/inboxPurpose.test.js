const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

/**
 * Mirrors dashboard/src/lib/inboxPurpose.ts classify + signal labels.
 * Keep in lockstep when changing purpose stamps.
 */
const JOB_INTENTS = new Set(["book_visit", "reschedule", "cancel"]);
const HOLD_INTENTS = new Set([
  "hold_or_pickup",
  "order_enquiry",
  "callback",
  "hold",
  "order",
]);
const HUMAN_INTENTS = new Set(["human", "emergency", "complaint", "escalate", "handoff"]);
const ANSWER_INTENTS = new Set([
  "hours",
  "hours_open",
  "location",
  "directions",
  "price",
  "price_band",
  "availability",
  "policy",
  "service_inquiry",
  "service_area",
  "general_enquiry",
  "other",
]);

const INTENT_ALIASES = {
  hold: "hold_or_pickup",
  hold_or_pickup: "hold_or_pickup",
  hours: "hours_open",
  hours_open: "hours_open",
  location: "directions",
  order: "order_enquiry",
  order_enquiry: "order_enquiry",
  enquiry: "order_enquiry",
  booking: "book_visit",
  book_visit: "book_visit",
  cancellation: "cancel",
  cancel: "cancel",
  reschedule: "reschedule",
};

function canonicalInboxIntent(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key || key === "unknown") return "";
  return INTENT_ALIASES[key] || key;
}

function classify({ primaryIntent, resolution, leadStatus, hold, job, callStatus }) {
  const s = String(callStatus || "").toLowerCase();
  if (s === "in_progress" || s === "ringing" || s === "queued") return "live";
  if (job) return "job";
  if (hold) return "hold";
  const intent = canonicalInboxIntent(primaryIntent);
  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
  if (intent === "product_inquiry") return "missed";
  if (resolution === "resolved" || ANSWER_INTENTS.has(intent)) return "answered";
  if (leadStatus === "new") return "missed";
  return "answered";
}

function holdTypeLabel(type) {
  switch (type) {
    case "hold":
      return "Hold";
    case "order":
      return "Order";
    case "callback":
      return "Callback";
    case "enquiry":
      return "Enquiry";
    default:
      return type || "Hold";
  }
}

function purposeLabel(purpose) {
  switch (purpose) {
    case "live":
      return "Live";
    case "job":
      return "Visit";
    case "hold":
      return "Hold";
    case "human":
      return "Human asked";
    case "missed":
      return "Missed";
    default:
      return "Answered";
  }
}

function signalLabel({ purpose, hold, job, vertical }) {
  if (purpose === "job") {
    if (!job) return "Visit not booked";
    const status = String(job.status || "").toLowerCase();
    if (status === "confirmed") return "Visit";
    if (status === "done") return "Visit done";
    if (status === "cancelled") return "Cancelled";
    return "Confirm visit";
  }
  if (purpose === "hold") {
    if (!hold) return "Hold not saved";
    const status = String(hold.status || "").toLowerCase();
    if (status === "fulfilled") return "Item done";
    if (status === "cancelled") return "Cancelled";
    return holdTypeLabel(hold.request_type || "hold");
  }
  return purposeLabel(purpose);
}

function inboxCaption(items) {
  const needs = items.filter((item) => item.needsYou).length;
  if (needs === 0) return "Clear";
  const toConfirm = items.filter(
    (item) => item.job && String(item.job.status || "").toLowerCase() === "requested"
  ).length;
  const toFulfill = items.filter(
    (item) => item.hold && String(item.hold.status || "").toLowerCase() === "open"
  ).length;
  if (toConfirm === needs) {
    return toConfirm === 1 ? "1 to confirm" : `${toConfirm} to confirm`;
  }
  if (toFulfill === needs) {
    return toFulfill === 1 ? "1 Hold Done" : `${toFulfill} Hold Done`;
  }
  const bits = [`${needs} need you`];
  if (toConfirm > 0) bits.push(`${toConfirm} to confirm`);
  else if (toFulfill > 0) bits.push(`${toFulfill} Hold Done`);
  return bits.length === 1 ? bits[0] : `${bits[0]}. ${bits[1]}.`;
}

function compareInboxRecency(a, b) {
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

function compareInboxSignal(a, b) {
  function rank(item) {
    if (item.urgent && item.needsYou) return 0;
    return 1;
  }
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;
  return compareInboxRecency(a, b);
}

function orderInboxItems(items, filter) {
  const rows = [...items];
  if (filter === "all" || filter === "answered" || filter === "hold") {
    rows.sort(compareInboxRecency);
  }
  rows.sort((a, b) => {
    const ap = a.pinnedAt || "";
    const bp = b.pinnedAt || "";
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp && ap !== bp) return ap < bp ? 1 : -1;
    return 0;
  });
  return rows;
}

function homeBriefing({ toReturn, toFulfill, toConfirm }) {
  const bits = [];
  if (toConfirm > 0) bits.push(`${toConfirm} to confirm`);
  if (toFulfill > 0) bits.push(`${toFulfill} Hold Done`);
  if (toReturn > 0) bits.push(`${toReturn} to return`);
  if (bits.length === 0) return "Clear";
  return `${bits.join(". ")}.`;
}

function homeQueueUnit(count, fallback, sample) {
  if (count === 1) {
    const text = typeof sample === "string" ? sample.trim() : "";
    if (text && text.length <= 28) return text;
  }
  return fallback;
}

function nairobiDayKey(d) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nairobiTime(iso) {
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(iso))
    .replace(/\s?(am|pm)$/i, (_, mer) => ` ${mer.toUpperCase()}`);
}

function formatCallWhenRelative(iso, now = new Date()) {
  const time = nairobiTime(iso);
  const thenDay = nairobiDayKey(new Date(iso));
  const today = nairobiDayKey(now);
  if (thenDay === today) return `at ${time}`;
  const [ty, tm, td] = today.split("-").map(Number);
  const [yy, ym, yd] = thenDay.split("-").map(Number);
  const diffDays = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(yy, ym - 1, yd)) / 86400000
  );
  if (diffDays === -1) return `Tomorrow, ${time}`;
  if (Math.abs(diffDays) < 7) {
    const weekday = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      weekday: "short",
    }).format(new Date(iso));
    return `${weekday}, ${time}`;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
  return `${date}, ${time}`;
}

describe("inbox purpose", () => {
  it("stamps an in-progress call as live", () => {
    assert.equal(classify({ callStatus: "in_progress", leadStatus: "new" }), "live");
    assert.equal(classify({ callStatus: "in_progress", primaryIntent: "product_inquiry" }), "live");
  });

  it("stamps hangup product inquiry as an active lead, not answered", () => {
    assert.equal(
      classify({
        callStatus: "complete",
        primaryIntent: "product_inquiry",
        resolution: "resolved",
        leadStatus: "new",
      }),
      "missed"
    );
    assert.equal(
      classify({
        callStatus: "complete",
        primaryIntent: "general_enquiry",
        resolution: "resolved",
        leadStatus: "new",
      }),
      "answered"
    );
  });

  it("stamps a visit row as job over hold", () => {
    assert.equal(
      classify({
        hold: { id: "r1" },
        job: { id: "a1" },
      }),
      "job"
    );
  });

  it("stamps an open hold from the request row", () => {
    assert.equal(classify({ hold: { id: "r1" } }), "hold");
  });

  it("stamps escalate as human", () => {
    assert.equal(classify({ resolution: "needs_human" }), "human");
  });

  it("stamps hours as answered", () => {
    assert.equal(classify({ primaryIntent: "hours", resolution: "resolved" }), "answered");
  });

  it("stamps abandoned as missed", () => {
    assert.equal(classify({ resolution: "abandoned" }), "missed");
  });

  it("reads Brain hold_or_pickup and order_enquiry as hold", () => {
    assert.equal(classify({ primaryIntent: "hold_or_pickup" }), "hold");
    assert.equal(classify({ primaryIntent: "hold" }), "hold");
    assert.equal(classify({ primaryIntent: "order_enquiry" }), "hold");
  });

  it("treats a new product inquiry as Needs you unless a booking or hold exists", () => {
    assert.equal(
      classify({ primaryIntent: "product_inquiry", leadStatus: "new" }),
      "missed"
    );
    assert.equal(
      classify({
        primaryIntent: "product_inquiry",
        resolution: "resolved",
        job: { id: "a1", status: "requested" },
      }),
      "job"
    );
    assert.equal(
      classify({
        primaryIntent: "product_inquiry",
        resolution: "resolved",
        hold: { id: "r1", status: "open" },
      }),
      "hold"
    );
    assert.equal(
      classify({ primaryIntent: "hours_open", leadStatus: "new" }),
      "answered"
    );
  });

  it("stamps book_visit as job from the Brain id", () => {
    assert.equal(classify({ primaryIntent: "book_visit" }), "job");
    assert.equal(classify({ primaryIntent: "booking" }), "job");
  });
});

function inboxNeedsYou({ purpose, leadStatus, hold, job }) {
  if (purpose === "live") return true;
  if (purpose === "answered") return false;
  const jobStatus = String(job?.status || "").toLowerCase();
  const holdStatus = String(hold?.status || "").toLowerCase();
  if (job && jobStatus === "requested") return true;
  if (hold && holdStatus === "open") return true;
  const leadOpen = leadStatus !== "resolved" && leadStatus !== "archived";
  if (purpose === "job" && !job && leadOpen) return true;
  if (purpose === "hold" && !hold && leadOpen) return true;
  if (purpose === "human" && leadOpen) return true;
  if (purpose === "missed" && leadOpen) return true;
  return false;
}

function itemMatchesPurpose(item, filter) {
  const archived = item.lead?.leadStatus === "archived";
  if (filter === "archived") return archived;
  if (archived) return false;
  if (filter === "all") return true;
  if (filter === "needs") return item.needsYou;
  if (filter === "hold") {
    return Boolean(item.hold) && String(item.hold.status || "").toLowerCase() === "open";
  }
  if (filter === "job") {
    const status = String(item.job?.status || "").toLowerCase();
    return Boolean(item.job) && (status === "requested" || status === "confirmed");
  }
  if (filter === "human") return item.purpose === "human" || item.purpose === "missed";
  if (filter === "answered") return item.purpose === "answered";
  return true;
}

describe("inbox signal", () => {
  it("names the next action instead of Job or Hold", () => {
    assert.equal(signalLabel({ purpose: "job", job: { status: "requested" } }), "Confirm visit");
    assert.equal(signalLabel({ purpose: "job", job: { status: "confirmed" } }), "Visit");
    assert.equal(signalLabel({ purpose: "job" }), "Visit not booked");
    assert.equal(
      signalLabel({ purpose: "job", vertical: "hospitality" }),
      "Visit not booked"
    );
    assert.equal(signalLabel({ purpose: "hold" }), "Hold not saved");
    assert.equal(
      signalLabel({ purpose: "hold", hold: { status: "open", request_type: "order" } }),
      "Order"
    );
    assert.equal(signalLabel({ purpose: "human" }), "Human asked");
    assert.equal(purposeLabel("job"), "Visit");
  });

  it("briefs mixed work in owner verbs", () => {
    assert.equal(inboxCaption([]), "Clear");
    assert.equal(
      inboxCaption([{ needsYou: true, job: { status: "requested" } }]),
      "1 to confirm"
    );
    assert.equal(
      inboxCaption([{ needsYou: true, hold: { status: "open" } }]),
      "1 Hold Done"
    );
    assert.equal(
      inboxCaption([
        { needsYou: true, job: { status: "requested" } },
        { needsYou: true, hold: { status: "open" } },
      ]),
      "2 need you. 1 to confirm."
    );
  });

  it("orders All by latest, including answered hangups", () => {
    const olderUrgent = {
      needsYou: true,
      urgent: true,
      purpose: "human",
      createdAt: "2026-09-16T17:54:51.000Z",
    };
    const latestAnswered = {
      needsYou: false,
      urgent: false,
      purpose: "answered",
      createdAt: "2026-09-17T07:01:47.000Z",
    };
    const rows = orderInboxItems([olderUrgent, latestAnswered], "all");
    assert.equal(rows[0], latestAnswered);
    assert.equal(rows[1], olderUrgent);
  });

  it("keeps a just-ended answered call on All above older visits", () => {
    const visit = {
      needsYou: true,
      urgent: false,
      purpose: "job",
      job: { status: "requested" },
      createdAt: "2026-09-16T05:14:00.000Z",
    };
    const justEnded = {
      needsYou: false,
      urgent: false,
      purpose: "answered",
      createdAt: "2026-09-17T07:01:47.000Z",
    };
    const rows = [visit, justEnded].sort(compareInboxSignal);
    assert.equal(rows[0], justEnded);
    assert.equal(rows[1], visit);
  });

  it("pins urgent Needs you above a newer answered call", () => {
    const urgent = {
      needsYou: true,
      urgent: true,
      purpose: "human",
      createdAt: "2026-09-16T08:00:00.000Z",
    };
    const justEnded = {
      needsYou: false,
      urgent: false,
      purpose: "answered",
      createdAt: "2026-09-17T07:01:47.000Z",
    };
    const rows = [justEnded, urgent].sort(compareInboxSignal);
    assert.equal(rows[0], urgent);
  });

  it("sorts a newer hold above an older visit", () => {
    const hold = {
      needsYou: true,
      urgent: false,
      purpose: "hold",
      hold: { status: "open" },
      createdAt: "2026-09-07T12:00:00.000Z",
    };
    const visit = {
      needsYou: true,
      urgent: false,
      purpose: "job",
      job: { status: "requested" },
      createdAt: "2026-09-07T08:00:00.000Z",
    };
    const rows = [hold, visit].sort(compareInboxSignal);
    assert.equal(rows[0], hold);
  });

  it("ranks the newest missed call above an intent-only return", () => {
    const intentOnly = {
      needsYou: true,
      urgent: false,
      purpose: "job",
      job: null,
      createdAt: "2026-09-16T12:23:00.000Z",
    };
    const lastCall = {
      needsYou: true,
      urgent: false,
      purpose: "missed",
      createdAt: "2026-09-16T15:36:00.000Z",
    };
    const realVisit = {
      needsYou: true,
      urgent: false,
      purpose: "job",
      job: { status: "requested" },
      createdAt: "2026-09-16T05:14:00.000Z",
    };
    const rows = [intentOnly, lastCall, realVisit].sort(compareInboxSignal);
    assert.equal(rows[0], lastCall);
    assert.equal(rows[1], intentOnly);
    assert.equal(rows[2], realVisit);
  });

  it("ranks a new return call above older unconfirmed visits", () => {
    const oldVisit = {
      needsYou: true,
      urgent: false,
      purpose: "job",
      job: { status: "requested" },
      createdAt: "2026-08-16T01:15:11.000Z",
    };
    const newHuman = {
      needsYou: true,
      urgent: false,
      purpose: "human",
      createdAt: "2026-09-16T17:54:51.000Z",
    };
    const rows = [oldVisit, newHuman].sort(compareInboxSignal);
    assert.equal(rows[0], newHuman);
    assert.equal(rows[1], oldVisit);
  });

  it("ranks a new human-asked call above older missed hangups", () => {
    const olderMissed = {
      needsYou: true,
      urgent: false,
      purpose: "missed",
      createdAt: "2026-09-16T15:36:00.000Z",
    };
    const newHuman = {
      needsYou: true,
      urgent: false,
      purpose: "human",
      createdAt: "2026-09-16T17:54:00.000Z",
    };
    const rows = [olderMissed, newHuman].sort(compareInboxSignal);
    assert.equal(rows[0], newHuman);
    assert.equal(rows[1], olderMissed);
  });

  it("briefs Home by the sharpest queue", () => {
    assert.equal(
      homeBriefing({ toReturn: 1, toFulfill: 2, toConfirm: 3 }),
      "3 to confirm. 2 Hold Done. 1 to return."
    );
    assert.equal(homeBriefing({ toReturn: 0, toFulfill: 2, toConfirm: 0 }), "2 Hold Done.");
    assert.equal(homeBriefing({ toReturn: 0, toFulfill: 0, toConfirm: 0 }), "Clear");
    assert.equal(homeQueueUnit(1, "to confirm", "Tue 14:00"), "Tue 14:00");
    assert.equal(homeQueueUnit(2, "to confirm", "Tue 14:00"), "to confirm");
    assert.equal(
      homeQueueUnit(
        1,
        "to confirm",
        "Caller wants a deep clean of the three bedroom house in Westlands this Saturday morning."
      ),
      "to confirm"
    );
  });

  it("labels When as at-time, weekday, or month day in Nairobi", () => {
    const now = new Date("2026-09-07T12:00:00+03:00");
    assert.match(formatCallWhenRelative("2026-09-07T08:00:00+03:00", now), /^at /);
    assert.match(formatCallWhenRelative("2026-09-08T10:00:00+03:00", now), /^Tomorrow,/);
    assert.match(formatCallWhenRelative("2026-09-09T10:00:00+03:00", now), /^Wed,/);
    assert.match(formatCallWhenRelative("2026-09-22T10:00:00+03:00", now), /^Sep 22,/);
    assert.match(formatCallWhenRelative("2026-09-07T08:00:00+03:00", now), /AM|PM/);
    const triage = fs.readFileSync(
      path.join(__dirname, "..", "dashboard/src/lib/callsTriage.ts"),
      "utf8"
    );
    assert.match(triage, /hour12: true/);
  });
});

describe("inbox piles", () => {
  it("keeps Needs you as open decisions only", () => {
    assert.equal(
      inboxNeedsYou({ purpose: "job", job: { status: "requested" } }),
      true
    );
    assert.equal(
      inboxNeedsYou({ purpose: "job", job: { status: "confirmed" } }),
      false
    );
    assert.equal(
      inboxNeedsYou({ purpose: "hold", hold: { status: "open" } }),
      true
    );
    assert.equal(
      inboxNeedsYou({ purpose: "hold", hold: { status: "fulfilled" } }),
      false
    );
    assert.equal(inboxNeedsYou({ purpose: "human", leadStatus: "new" }), true);
    assert.equal(inboxNeedsYou({ purpose: "live" }), true);
    assert.equal(inboxNeedsYou({ purpose: "answered" }), false);
    assert.equal(
      inboxNeedsYou({ purpose: "missed", leadStatus: "new" }),
      true
    );
    assert.equal(
      inboxNeedsYou({ purpose: "job", job: null, leadStatus: "new" }),
      true
    );
    assert.equal(
      inboxNeedsYou({ purpose: "hold", hold: null, leadStatus: "new" }),
      true
    );
  });

  it("puts confirmed visits in Visits not Needs you", () => {
    const booked = { needsYou: false, job: { status: "confirmed" }, purpose: "job" };
    const pending = { needsYou: true, job: { status: "requested" }, purpose: "job" };
    const done = { needsYou: false, job: { status: "done" }, purpose: "job" };
    const intentOnly = { needsYou: true, job: null, purpose: "job" };
    assert.equal(itemMatchesPurpose(pending, "needs"), true);
    assert.equal(itemMatchesPurpose(pending, "job"), true);
    assert.equal(itemMatchesPurpose(booked, "needs"), false);
    assert.equal(itemMatchesPurpose(booked, "job"), true);
    assert.equal(itemMatchesPurpose(done, "job"), false);
    assert.equal(itemMatchesPurpose(intentOnly, "job"), false);
  });

  it("puts open holds in Holds and leaves fulfilled out", () => {
    const open = { hold: { status: "open" }, purpose: "hold" };
    const fulfilled = { hold: { status: "fulfilled" }, purpose: "hold" };
    assert.equal(itemMatchesPurpose(open, "hold"), true);
    assert.equal(itemMatchesPurpose(fulfilled, "hold"), false);
  });

  it("keeps a live call on Needs you and All, not Human or Answered", () => {
    const live = { purpose: "live", needsYou: true };
    assert.equal(itemMatchesPurpose(live, "needs"), true);
    assert.equal(itemMatchesPurpose(live, "all"), true);
    assert.equal(itemMatchesPurpose(live, "human"), false);
    assert.equal(itemMatchesPurpose(live, "answered"), false);
  });

  it("drops answered hangup from Needs you and keeps it on All", () => {
    const answered = { purpose: "answered", needsYou: false };
    assert.equal(itemMatchesPurpose(answered, "needs"), false);
    assert.equal(itemMatchesPurpose(answered, "all"), true);
    assert.equal(itemMatchesPurpose(answered, "answered"), true);
  });

  it("puts archived rows on Archived only", () => {
    const row = {
      purpose: "missed",
      needsYou: false,
      lead: { leadStatus: "archived" },
    };
    assert.equal(itemMatchesPurpose(row, "archived"), true);
    assert.equal(itemMatchesPurpose(row, "all"), false);
    assert.equal(itemMatchesPurpose(row, "needs"), false);
    assert.equal(itemMatchesPurpose(row, "human"), false);
  });
});

describe("inbox phone join", () => {
  const { normalizeKenyaE164 } = require("../src/conversation/liveTransferReady");

  function storedPhoneCandidates(raw) {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return [];
    const seen = new Set();
    const out = [];
    const e164 = normalizeKenyaE164(trimmed);
    const stored = e164 || trimmed;
    for (const phone of [trimmed, stored, e164, e164 ? e164.slice(1) : null]) {
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      out.push(phone);
    }
    return out;
  }

  function attachContactIds(items, contacts) {
    const byPhone = new Map();
    for (const row of contacts) {
      if (!row.phone) continue;
      const person = { id: row.id, name: row.name || null };
      for (const key of storedPhoneCandidates(row.phone)) {
        byPhone.set(key, person);
      }
    }
    return items.map((item) => {
      const person =
        (item.callerPhone &&
          (byPhone.get(item.callerPhone) ||
            byPhone.get(normalizeKenyaE164(item.callerPhone) || ""))) ||
        null;
      return { ...item, contactId: person?.id || null };
    });
  }

  it("joins +254 call phones to 254 contacts and the reverse", () => {
    const plus = attachContactIds(
      [{ callerPhone: "+254712345678" }],
      [{ id: "c1", phone: "254712345678", name: "Amina" }]
    );
    assert.equal(plus[0].contactId, "c1");
    const national = attachContactIds(
      [{ callerPhone: "254712345678" }],
      [{ id: "c2", phone: "+254712345678", name: "Brian" }]
    );
    assert.equal(national[0].contactId, "c2");
  });
});

describe("inboxPurpose source lockstep", () => {
  it("keeps All newest-first and stamps in-progress as Live", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "..", "dashboard/src/lib/inboxPurpose.ts"),
      "utf8"
    );
    const page = fs.readFileSync(
      path.join(__dirname, "..", "dashboard/src/app/(desk)/calls/page.tsx"),
      "utf8"
    );
    assert.match(src, /if \(item\.urgent && item\.needsYou\) return 0;/);
    assert.match(src, /if \(isLiveCallStatus\(opts\.callStatus\)\) return "live";/);
    assert.match(src, /if \(opts\.purpose === "live"\) return true;/);
    assert.match(src, /export function compareInboxRecency/);
    assert.match(src, /filter === "all" \|\| filter === "answered" \|\| filter === "archived" \|\| filter === "hold"/);
    assert.match(page, /orderInboxItems\(/);
    assert.doesNotMatch(src, /if \(item\.needsYou\) return 1;/);
    assert.match(src, /if \(intent === "product_inquiry"\) return "missed";/);
    assert.doesNotMatch(src, /"product_inquiry",\s*"service_inquiry"/);
    assert.match(src, /if \(!opts\.job\) return copy\.visitGhostStamp;/);
    assert.match(src, /if \(!opts\.hold\) return copy\.holdGhostStamp;/);
    assert.match(src, /storedPhoneCandidates/);
  });
});
