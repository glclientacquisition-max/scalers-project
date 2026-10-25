// Run: node --experimental-strip-types --test tests/alertTypeRowsUi.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as lib from "../dashboard/src/lib/notifyChannels.ts";

const require = createRequire(import.meta.url);
const js = require("../src/notifications/notifyChannels.js");
const all = { sms: true, whatsapp: true, email: true };

describe("Alert type rows (Desk logic)", () => {
  it("TS and backend agree on defaults and effective cells", () => {
    assert.deepEqual(lib.parseAlertTypes(null), js.ALERT_TYPE_DEFAULTS);
    for (const raw of [all, { sms: false, whatsapp: true, email: false }, { ...all, by_type: { booking: { sms: true } } }]) {
      for (const t of lib.ALERT_TYPES) {
        const a = lib.effectiveAlertCells(raw, t);
        const b = js.effectiveChannels(raw, t);
        for (const ch of lib.ALERT_CHANNELS) assert.equal(a[ch], b[ch], `${t}/${ch}`);
      }
    }
  });

  it("changed-only save: a toggle stores one cell, toggling back clears by_type", () => {
    const on = lib.toggleAlertCell(all, "booking", "sms");
    assert.deepEqual(on?.by_type, { booking: { sms: true } });
    const back = lib.toggleAlertCell(on!, "booking", "sms");
    assert.equal(back?.by_type, undefined);
  });

  it("missed-call guard blocks turning off the last live channel", () => {
    let v: lib.NotifyChannels | null = { sms: false, whatsapp: true, email: false, push: false };
    v = lib.toggleAlertCell(v, "missed_call", "whatsapp");
    assert.equal(v, null);
  });

  it("parse keeps by_type and push so a save never wipes them", () => {
    const p = lib.parseNotifyChannels({ ...all, push: false, by_type: { message: { email: false } } });
    // old key migrates to other_calls on parse
    assert.equal(p.push, false);
    assert.deepEqual(p.by_type, { other_calls: { email: false } });
  });

  it("reset drops all choices; copy is English", () => {
    assert.equal(lib.resetAlertChoices({ ...all, by_type: { booking: { sms: true } } }).by_type, undefined);
    const ui = readFileSync(new URL("../dashboard/src/components/AlertTypeRows.tsx", import.meta.url), "utf8");
    assert.match(ui, /aria-pressed/);
    assert.equal(lib.ALERT_TYPE_META.find((m) => m.id === "other_calls")?.label, "Other calls");
    assert.match(ui, /min-h-11/);
    assert.match(ui, /SMS is off for the whole business\./);
    assert.match(ui, /Missed calls need at least one way to reach you\./);
  });
});
