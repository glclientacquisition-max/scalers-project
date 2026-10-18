/**
 * Contact name lock (DESK_CONTACT_NAME_LOCK): the interim name fold, owner rename,
 * dismissed alternates, the one-person toggle, and the flag + role gates in the actions.
 * Contract from Brain 18 Oct 2026: metadata.single_person, metadata.name_locked {at, by:'owner'},
 * metadata.alternate_names_dismissed [{name, at}].
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { namesLikelySame } from "../dashboard/src/lib/nameFold.ts";

// contactNameLock imports "./nameFold" without an extension.
register("./tsResolveHook.mjs", pathToFileURL("./tests/"));
const lock = await import("../dashboard/src/lib/contactNameLock.ts");

const NOW = "2026-10-18T12:20:00.000Z";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const SAME: [string, string][] = [
  ["Alwyn", "Alvin"],
  ["alvin", "Alvin"],
  ["Álvin", "Alvin"],
  ["Brian", "Bryan"],
  ["Steven", "Stephen"],
  ["Catherine", "Katherine"],
  ["Collins", "Colin"],
  ["Mwangi", "Mwange"],
  ["Sarah", "Sara"],
  ["John", "Jon"],
  ["Alvin Yegon", "Alwyn Yegon"],
  ["Esther", "Ester"],
  ["Daniel", "Danielle"],
  ["Elijah", "Elija"],
];
const DIFFERENT: [string, string][] = [
  ["Wanjiru", "Wanjiku"],
  ["Alvin", "Kevin"],
  ["Kevin", "Devin"],
  ["Alvin", "Alex"],
  ["Otieno", "Atieno"],
  ["Joseph", "Josephine"],
  ["Grace", "Great"],
  ["Mary", "Gary"],
  ["Brian", "Ryan"],
  ["Alvin", "Alvin Yegon"],
  ["Amina", "Amani"],
  ["Njeri", "Njoki"],
  ["Achieng", "Akinyi"],
  ["Wairimu", "Wambui"],
  ["Faith", "Fatuma"],
];

describe("namesLikelySame (interim fold)", () => {
  for (const [a, b] of SAME) {
    it(`${a} ~ ${b}`, () => {
      assert.equal(namesLikelySame(a, b), true);
      assert.equal(namesLikelySame(b, a), true);
    });
  }
  for (const [a, b] of DIFFERENT) {
    it(`${a} != ${b}`, () => {
      assert.equal(namesLikelySame(a, b), false);
      assert.equal(namesLikelySame(b, a), false);
    });
  }
  it("rejects blanks and non-strings", () => {
    assert.equal(namesLikelySame("", "Alvin"), false);
    assert.equal(namesLikelySame(null, "Alvin"), false);
    assert.equal(namesLikelySame(undefined, undefined), false);
  });
  it("is one export so Brain's fold can replace it", () => {
    const src = read("dashboard/src/lib/nameFold.ts");
    assert.equal((src.match(/^export /gm) || []).length, 1);
    assert.match(src, /brain\/name-fold|BRAIN_NAME_FOLD/);
  });
});

const jirani = () => ({
  name: "Alwyn",
  metadata: {
    source: "call",
    alternate_names: [
      { name: "Alvin", seen_at: "2026-10-17T17:01:08.493Z", call_id: "HD_cd0c01f28b05" },
      { name: "Grace", seen_at: "2026-10-16T08:00:00.000Z", call_id: null },
    ],
  },
});

describe("ownerRename", () => {
  it("Alwyn to Alvin drops the Alvin alternate, keeps others, does not add Alwyn, locks", () => {
    const out = lock.ownerRename(jirani(), "Alvin", NOW, { lock: true });
    assert.equal(out.name, "Alvin");
    const names = lock.readAlternates(out.metadata).map((a: { name: string }) => a.name);
    assert.deepEqual(names, ["Grace"]);
    assert.ok(!names.includes("Alwyn"));
    assert.deepEqual(out.metadata.name_locked, { at: NOW, by: "owner" });
    assert.equal(out.metadata.source, "call");
  });
  it("drops near-spellings of the new name, not just exact matches", () => {
    const out = lock.ownerRename(
      { name: "Mteja", metadata: { alternate_names: [{ name: "Alwyn", seen_at: null, call_id: null }] } },
      "Alvin",
      NOW,
      { lock: true },
    );
    assert.deepEqual(lock.readAlternates(out.metadata), []);
    assert.ok(!JSON.stringify(out.metadata).includes("Mteja"));
  });
  it("does not lock when the renamer is not owner or admin", () => {
    const out = lock.ownerRename(jirani(), "Alvin", NOW, { lock: false });
    assert.equal(out.name, "Alvin");
    assert.equal(out.metadata.name_locked, undefined);
    assert.equal(lock.readAlternates(out.metadata).length, 1);
  });
  it("does not mutate the input", () => {
    const before = jirani();
    const snapshot = JSON.stringify(before);
    lock.ownerRename(before, "Alvin", NOW, { lock: true });
    assert.equal(JSON.stringify(before), snapshot);
  });
});

describe("dismissAlternate", () => {
  it("removes from alternate_names and appends to alternate_names_dismissed once", () => {
    const m1 = lock.dismissAlternate(jirani().metadata, "Alvin", NOW);
    assert.deepEqual(lock.readAlternates(m1).map((a: { name: string }) => a.name), ["Grace"]);
    assert.deepEqual(m1.alternate_names_dismissed, [{ name: "Alvin", at: NOW }]);
    const m2 = lock.dismissAlternate(m1, "álvin", NOW);
    assert.equal((m2.alternate_names_dismissed as unknown[]).length, 1);
  });
  it("caps the dismissed list", () => {
    let m: Record<string, unknown> = {};
    for (let i = 0; i < lock.DISMISSED_CAP + 5; i++) m = lock.dismissAlternate(m, `Name${i}`, NOW);
    assert.equal((m.alternate_names_dismissed as unknown[]).length, lock.DISMISSED_CAP);
  });
  it("hides dismissed names even if they come back in alternate_names", () => {
    const m = lock.dismissAlternate(jirani().metadata, "Alvin", NOW);
    const readded = { ...m, alternate_names: [...lock.readAlternates(m), { name: "ALVIN", seen_at: null, call_id: null }] };
    assert.deepEqual(lock.visibleAlternates(readded).map((a: { name: string }) => a.name), ["Grace"]);
    assert.equal(lock.isDismissedName(readded, "Alvin"), true);
  });
});

describe("setSinglePerson", () => {
  it("on sets single_person and name_locked by owner; off clears both", () => {
    const on = lock.setSinglePerson({ source: "call" }, true, NOW);
    assert.equal(on.single_person, true);
    assert.deepEqual(on.name_locked, { at: NOW, by: "owner" });
    const view = lock.readContactIdentity(on);
    assert.equal(view.singlePerson, true);
    assert.equal(view.nameLocked?.at, NOW);
    const off = lock.setSinglePerson(on, false, NOW);
    assert.equal("single_person" in off, false);
    assert.equal("name_locked" in off, false);
    assert.equal(off.source, "call");
  });
});

describe("display helpers", () => {
  it("states the count plainly", () => {
    assert.equal(lock.otherNamesLine(0), "No other names heard on this number.");
    assert.equal(lock.otherNamesLine(1), "1 other name heard on this number.");
    assert.equal(lock.otherNamesLine(3), "3 other names heard on this number.");
  });
  it("formats the heard day in Nairobi time and links only real call ids", () => {
    assert.equal(lock.heardDay("2026-10-17T22:30:00.000Z"), "18 Oct");
    assert.equal(lock.heardDay("2026-10-17T17:01:08.493Z"), "17 Oct");
    assert.equal(lock.alternateCallHref("HD_cd0c01f28b05"), null);
    assert.equal(
      lock.alternateCallHref("63f24644-86fe-4615-be2f-2030c92a1f0c"),
      "/calls/63f24644-86fe-4615-be2f-2030c92a1f0c",
    );
  });
});

describe("flag and role gates", () => {
  const actions = read("dashboard/src/app/(desk)/contacts/actions.ts");
  const flag = read("dashboard/src/lib/contactNameLockFlag.ts");
  it("flag is on only for the exact value on", () => {
    assert.match(flag, /process\.env\.DESK_CONTACT_NAME_LOCK/);
    assert.match(flag, /=== "on"/);
  });
  it("rename uses ownerRename only with the flag on, keeps the old path otherwise", () => {
    assert.match(actions, /contactNameLockFromEnv\(\)\s*\?\s*ownerRename\(/);
    assert.match(actions, /mergeContactIdentity\(/);
  });
  it("toggle and remove are owner/admin and flag gated", () => {
    for (const fn of ["setContactSinglePerson", "dismissContactAlternateName"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const head = body.slice(0, 400);
      assert.match(head, /memberDenied\("contacts\.import"\)/, fn);
      assert.match(head, /if \(!contactNameLockFromEnv\(\)\)/, fn);
    }
  });
  it("contact page renders the panel only with the flag on", () => {
    const page = read("dashboard/src/app/(desk)/contacts/[id]/page.tsx");
    assert.match(page, /contactNameLockFromEnv\(\) \? readContactIdentity/);
    assert.match(page, /\{identity \? \(\s*<ContactIdentityPanel/);
  });
});

describe("panel copy", () => {
  const panel = read("dashboard/src/components/ContactIdentityPanel.tsx");
  it("uses ConfirmSheet and a role gate, no dialogs or motion libraries", () => {
    assert.match(panel, /ConfirmSheet/);
    assert.match(panel, /withRoleGate\("contacts\.import"/);
    assert.doesNotMatch(panel, /DeskDialog|framer-motion|motion\/react/);
  });
  it("has no vendor names or long dashes", () => {
    assert.doesNotMatch(panel, /Twilio|Africa's Talking|OpenAI|Deepgram|ElevenLabs|Supabase|Vercel/i);
    assert.doesNotMatch(panel, /[\u2013\u2014]/);
    assert.match(panel, /This number is one person/);
    assert.match(panel, /Also heard as/);
  });
});
