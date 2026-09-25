const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function parseEatDateTimeLocal(raw) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(
    String(raw || "").trim()
  );
  if (!match) return null;
  const instant = new Date(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:00+03:00`
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function joinEatDateTime(date, time) {
  const day = String(date || "").trim();
  const clock = String(time || "").trim() || "00:00";
  if (!day) return "";
  return `${day}T${clock}`;
}

function resolveBulletinWindow(opts) {
  const now = opts.now || new Date();
  if (opts.expiry !== "schedule") {
    return { ok: true, startsNow: true };
  }
  const startsLocal = String(opts.startsLocal || "").trim();
  const endsLocal = String(opts.endsLocal || "").trim();
  const start = startsLocal ? parseEatDateTimeLocal(startsLocal) : now;
  if (startsLocal && !start) return { ok: false, error: "Set a valid start." };
  const end = endsLocal ? parseEatDateTimeLocal(endsLocal) : null;
  if (endsLocal && !end) return { ok: false, error: "Set a valid end." };
  if (end && start && start >= end) {
    return { ok: false, error: "End must be after start." };
  }
  return {
    ok: true,
    starts_at: (start || now).toISOString(),
    ends_at: end ? end.toISOString() : null,
  };
}

describe("daily bulletin window", () => {
  it("reads Nairobi datetime-local as an instant and rejects inverted ranges", () => {
    const start = parseEatDateTimeLocal("2026-09-26T14:00");
    assert.ok(start);
    assert.equal(start.toISOString(), "2026-09-26T11:00:00.000Z");
    const ok = resolveBulletinWindow({
      expiry: "schedule",
      startsLocal: "2026-09-26T14:00",
      endsLocal: "2026-09-26T18:00",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.starts_at, "2026-09-26T11:00:00.000Z");
    assert.equal(ok.ends_at, "2026-09-26T15:00:00.000Z");
    const inverted = resolveBulletinWindow({
      expiry: "schedule",
      startsLocal: "2026-09-26T18:00",
      endsLocal: "2026-09-26T14:00",
    });
    assert.equal(inverted.ok, false);
    const openEnd = resolveBulletinWindow({
      expiry: "schedule",
      startsLocal: "2026-09-26T14:00",
      endsLocal: "",
    });
    assert.equal(openEnd.ok, true);
    assert.equal(openEnd.ends_at, null);
    assert.equal(
      joinEatDateTime("2026-09-26", "14:00"),
      "2026-09-26T14:00"
    );
  });

  it("posts starts_at and ends_at from Pick using date and time fields", () => {
    const lib = read("dashboard/src/lib/dailyBulletin.ts");
    const actions = read("dashboard/src/app/(desk)/settings/bulletinActions.ts");
    const panel = read("dashboard/src/components/DailyBulletinPanel.tsx");
    assert.match(lib, /export type BulletinExpiry = .*\| "schedule"/);
    assert.match(lib, /export function parseEatDateTimeLocal/);
    assert.match(lib, /export function joinEatDateTime/);
    assert.match(lib, /export function formatBulletinComposePreview/);
    assert.match(lib, /export function resolveBulletinWindow/);
    assert.match(lib, /export function deskBulletinItems/);
    assert.match(lib, /export function formatBulletinWindowLabel/);
    assert.match(actions, /resolveBulletinWindow/);
    assert.match(actions, /formData.get\("starts_at"\)/);
    assert.match(actions, /formData.get\("ends_at"\)/);
    assert.match(actions, /deskBulletinItems/);
    assert.match(actions, /Update is set\. Callers hear it after the start\./);
    assert.match(panel, /id: "schedule", label: "Pick"/);
    assert.match(panel, /label: "Now"/);
    assert.match(panel, /label: "Later"/);
    assert.match(panel, /type="date"/);
    assert.match(panel, /type="time"/);
    assert.doesNotMatch(panel, /datetime-local/);
    assert.match(panel, /name="starts_at"/);
    assert.match(panel, /name="ends_at"/);
    assert.match(panel, /formatBulletinComposePreview/);
    assert.match(panel, /deskBulletinItems/);
    assert.match(panel, /formatBulletinWindowLabel/);
    assert.doesNotMatch(panel, /[\u2014\u2013]/);
    assert.doesNotMatch(lib, /[\u2014\u2013]/);
  });
});
