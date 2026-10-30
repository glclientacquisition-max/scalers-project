// Add many: the business address and hours written as a sentence as review cards (gaps left by #1046).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildFactCards, mightHaveFacts } from "../dashboard/src/lib/importFactDiff.ts";
import { parseHoursText } from "../dashboard/src/lib/hoursText.ts";
import { settingsFieldFromScope } from "../dashboard/src/lib/settingsSaveScope.ts";

const read = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", p), "utf8");
const base = { business_hours: "", hours_schedule: null, business_locations: [], business_policies: {}, faqs: [] };
const loc = (address: string, landmark = "") => [{ label: "Main", address, landmark, directions: "", coverage_notes: "" }];

test("hours sentences become the weekly grid", () => {
  const r = parseHoursText("Monday to Saturday 8am - 7pm, Sunday closed");
  assert.equal(r?.unsure, false);
  assert.deepEqual(r?.schedule.days.mon, { open: "08:00", close: "19:00" });
  assert.deepEqual(r?.schedule.days.sat, { open: "08:00", close: "19:00" });
  assert.equal(r?.schedule.days.sun, null);
  const w = parseHoursText("Weekdays 08:00-17:30; Sat 9am-1pm");
  assert.deepEqual(w?.schedule.days.fri, { open: "08:00", close: "17:30" });
  assert.deepEqual(w?.schedule.days.sat, { open: "09:00", close: "13:00" });
  assert.deepEqual(parseHoursText("Open daily 7.30am to 9pm")?.schedule.days.sun, { open: "07:30", close: "21:00" });
  assert.equal(parseHoursText("call us anytime"), null);
});

test("guesses are flagged: bare hours, half day, no days", () => {
  const r = parseHoursText("Mon-Fri 8 to 6, Sat half day");
  assert.equal(r?.unsure, true);
  assert.deepEqual(r?.schedule.days.wed, { open: "08:00", close: "18:00" });
  assert.deepEqual(r?.schedule.days.sat, { open: "08:00", close: "13:00" });
  assert.match(r?.note || "", /AM and PM/);
  assert.match(r?.note || "", /Half day/);
  assert.equal(parseHoursText("8 to 6")?.unsure, true);
});

test("an unsure hours card opens unticked with its note; a clear one is ticked", () => {
  const unsure = buildFactCards({ tenant: base as never, draft: { hoursNotes: "Mon-Fri 8 to 6, Sat half day" } as never });
  const h = unsure.find((c) => c.kind === "hours");
  assert.equal(h?.on, false);
  assert.match(h?.note || "", /Half day/);
  assert.equal(h?.now, "Not set");
  const sure = buildFactCards({ tenant: base as never, draft: { hoursNotes: "Mon-Sat 8am-6pm, Sun closed" } as never });
  assert.equal(sure.find((c) => c.kind === "hours")?.on, true);
  const owner = buildFactCards({ tenant: base as never, draft: { hoursNotes: "Mon-Sat 8am-6pm" } as never, ownerPaths: new Set(["hours.weekly_grid"]) });
  assert.equal(owner.find((c) => c.kind === "hours")?.on, false);
});

test("hours card keeps the stored location line", () => {
  const t = { ...base, hours_schedule: { timezone: "Africa/Nairobi", location: "Kilimani shop", days: { mon: { open: "09:00", close: "17:00" } } } };
  const c = buildFactCards({ tenant: t as never, draft: { hoursNotes: "Mon-Sat 8am-6pm" } as never }).find((x) => x.kind === "hours");
  assert.equal(c?.kind === "hours" && c.schedule.location, "Kilimani shop");
});

test("address card: Now vs Found, owner-set unticked, same address skipped, junk refused", () => {
  const c = buildFactCards({ tenant: base as never, draft: { locations: loc("Ngong Road, Kilimani", "Opposite Prestige Plaza") } as never });
  const a = c.find((x) => x.kind === "address");
  assert.equal(a?.now, "Not set");
  assert.equal(a?.found, "Ngong Road, Kilimani · Opposite Prestige Plaza");
  assert.equal(a?.on, true);
  const owned = buildFactCards({ tenant: { ...base, business_locations: loc("Moi Avenue") } as never, draft: { locations: loc("Ngong Road") } as never, ownerPaths: new Set(["locations.branches"]) });
  const o = owned.find((x) => x.kind === "address");
  assert.equal(o?.ownerSet, true);
  assert.equal(o?.on, false);
  assert.equal(o?.now, "Moi Avenue");
  const same = buildFactCards({ tenant: { ...base, business_locations: loc("Ngong Road") } as never, draft: { locations: loc("ngong road.") } as never });
  assert.equal(same.some((x) => x.kind === "address"), false);
  const junk = buildFactCards({ tenant: base as never, draft: { locations: loc("https://evil.example/x") } as never });
  assert.equal(junk.some((x) => x.kind === "address"), false);
  const tags = buildFactCards({ tenant: base as never, draft: { locations: loc("<script>x</script> Ngong Rd") } as never }).find((x) => x.kind === "address");
  assert.equal(/[<>]/.test(tags?.found || ""), false);
});

test("address save owns only the places list", () => {
  assert.equal(settingsFieldFromScope("locations-address", "businessLocations", "form", "stored"), "form");
  for (const f of ["locationNotes", "serviceAreas", "noPremises", "businessName", "vertical", "greetingInvite", "hoursSchedule", "teamDirectory"]) {
    assert.equal(settingsFieldFromScope("locations-address", f, "form", "stored"), "stored", f);
  }
  const src = read("dashboard/src/app/(desk)/settings/knowledge/foundFactsActions.ts");
  assert.match(src, /settings_scope", "locations-address"/);
  assert.match(src, /memberDenied\("settings\.edit"\)/);
  assert.match(read("dashboard/src/components/catalogue/KnowledgeCatalogue.tsx"), /saveFoundAddressAction/);
});

test("address and sentence hours wake the fact read", () => {
  assert.equal(mightHaveFacts("We are located on Ngong Road opposite the mall"), true);
  assert.equal(mightHaveFacts("Weekdays 8 to 6"), true);
});
