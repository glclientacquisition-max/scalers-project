const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

/**
 * Mirrors dashboard/src/lib/inboxPurpose.ts classify + signal labels.
 * Keep in lockstep when changing purpose stamps.
 */
const JOB_INTENTS = new Set(["book_visit", "booking", "reschedule", "cancel", "cancellation"]);
const HOLD_INTENTS = new Set(["hold", "order", "enquiry", "callback"]);
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
  "other",
]);

function classify({ primaryIntent, resolution, leadStatus, hold, job }) {
  if (job) return "job";
  if (hold) return "hold";
  const intent = String(primaryIntent || "").trim().toLowerCase();
  if (HUMAN_INTENTS.has(intent) || resolution === "needs_human") return "human";
  if (JOB_INTENTS.has(intent)) return "job";
  if (HOLD_INTENTS.has(intent)) return "hold";
  if (resolution === "abandoned" || resolution === "unresolved") return "missed";
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

function signalLabel({ purpose, hold, job }) {
  if (purpose === "job") {
    const status = String(job?.status || "").toLowerCase();
    if (status === "confirmed") return "Visit";
    if (status === "done") return "Visit done";
    if (status === "cancelled") return "Cancelled";
    return "Confirm visit";
  }
  if (purpose === "hold") {
    const status = String(hold?.status || "").toLowerCase();
    if (status === "fulfilled") return "Item done";
    if (status === "cancelled") return "Cancelled";
    return holdTypeLabel(hold?.request_type || "hold");
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
    return toFulfill === 1 ? "1 to fulfill" : `${toFulfill} to fulfill`;
  }
  const bits = [`${needs} need you`];
  if (toConfirm > 0) bits.push(`${toConfirm} to confirm`);
  else if (toFulfill > 0) bits.push(`${toFulfill} to fulfill`);
  return bits.length === 1 ? bits[0] : `${bits[0]}. ${bits[1]}.`;
}

function compareInboxSignal(a, b) {
  if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
  if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
  if (a.createdAt < b.createdAt) return 1;
  if (a.createdAt > b.createdAt) return -1;
  return 0;
}

function homeBriefing({ toReturn, toFulfill, toConfirm }) {
  const bits = [];
  if (toConfirm > 0) bits.push(`${toConfirm} to confirm`);
  if (toFulfill > 0) bits.push(`${toFulfill} to fulfill`);
  if (toReturn > 0) bits.push(`${toReturn} to return`);
  if (bits.length === 0) return "Clear";
  return `${bits.join(". ")}.`;
}

function homeQueueUnit(count, fallback, sample) {
  if (count === 1) {
    const text = typeof sample === "string" ? sample.trim() : "";
    if (text) return text;
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
  }).format(new Date(iso));
}

function formatCallWhenRelative(iso, now = new Date()) {
  const time = nairobiTime(iso);
  const thenDay = nairobiDayKey(new Date(iso));
  const today = nairobiDayKey(now);
  if (thenDay === today) return `Today ${time}`;
  const [ty, tm, td] = today.split("-").map(Number);
  const [yy, ym, yd] = thenDay.split("-").map(Number);
  const diffDays = Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(yy, ym - 1, yd)) / 86400000
  );
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays > 1 && diffDays < 7) {
    const weekday = new Intl.DateTimeFormat("en-KE", {
      timeZone: "Africa/Nairobi",
      weekday: "short",
    }).format(new Date(iso));
    return `${weekday} ${time}`;
  }
  return new Intl.DateTimeFormat("en-KE", {
    timeZone: "Africa/Nairobi",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

describe("inbox purpose", () => {
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
});

describe("inbox signal", () => {
  it("names the next action instead of Job or Hold", () => {
    assert.equal(signalLabel({ purpose: "job", job: { status: "requested" } }), "Confirm visit");
    assert.equal(signalLabel({ purpose: "job", job: { status: "confirmed" } }), "Visit");
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
      inboxCaption([
        { needsYou: true, job: { status: "requested" } },
        { needsYou: true, hold: { status: "open" } },
      ]),
      "2 need you. 1 to confirm."
    );
  });

  it("sorts work that needs the owner first", () => {
    const answered = { needsYou: false, urgent: false, createdAt: "2026-09-07T12:00:00.000Z" };
    const olderNeed = { needsYou: true, urgent: false, createdAt: "2026-09-07T08:00:00.000Z" };
    const rows = [answered, olderNeed].sort(compareInboxSignal);
    assert.equal(rows[0], olderNeed);
  });

  it("briefs Home by the sharpest queue", () => {
    assert.equal(
      homeBriefing({ toReturn: 1, toFulfill: 2, toConfirm: 3 }),
      "3 to confirm. 2 to fulfill. 1 to return."
    );
    assert.equal(homeBriefing({ toReturn: 0, toFulfill: 0, toConfirm: 0 }), "Clear");
    assert.equal(homeQueueUnit(1, "to confirm", "Tue 14:00"), "Tue 14:00");
    assert.equal(homeQueueUnit(2, "to confirm", "Tue 14:00"), "to confirm");
  });

  it("labels When as Today or Yesterday in Nairobi", () => {
    const now = new Date("2026-09-07T12:00:00+03:00");
    assert.match(formatCallWhenRelative("2026-09-07T08:00:00+03:00", now), /^Today /);
    assert.match(formatCallWhenRelative("2026-09-06T18:00:00+03:00", now), /^Yesterday /);
  });
});
