import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  OPTIMISTIC_OFFLINE_ERROR,
  runOptimistic,
  serverActionError,
} from "../dashboard/src/lib/optimisticAction.ts";

const root = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

function rig() {
  const log: string[] = [];
  let state = "before";
  return {
    log,
    get state() {
      return state;
    },
    apply: () => {
      state = "after";
      log.push("apply");
    },
    rollback: () => {
      state = "before";
      log.push("rollback");
    },
  };
}

describe("runOptimistic", () => {
  it("changes the screen before the server answers and keeps it on success", async () => {
    const r = rig();
    let seenDuring = "";
    const out = await runOptimistic({
      apply: r.apply,
      rollback: r.rollback,
      commit: async () => {
        seenDuring = r.state;
        return { ok: true };
      },
      failed: serverActionError,
      fallback: "Could not archive.",
    });
    assert.equal(seenDuring, "after");
    assert.equal(r.state, "after");
    assert.deepEqual(r.log, ["apply"]);
    assert.equal(out.ok, true);
  });

  it("rolls back with the server reason when the action returns an error", async () => {
    const r = rig();
    const out = await runOptimistic({
      apply: r.apply,
      rollback: r.rollback,
      commit: async () => ({ error: "You do not have access." }),
      failed: serverActionError,
      fallback: "Could not archive.",
    });
    assert.equal(r.state, "before");
    assert.deepEqual(r.log, ["apply", "rollback"]);
    assert.deepEqual(out, { ok: false, error: "You do not have access." });
  });

  it("rolls back with the fallback when ok is false and no reason", async () => {
    const r = rig();
    const out = await runOptimistic({
      apply: r.apply,
      rollback: r.rollback,
      commit: async () => ({ ok: false }),
      failed: serverActionError,
      fallback: "Could not mark done.",
    });
    assert.equal(r.state, "before");
    assert.deepEqual(out, { ok: false, error: "Could not mark done." });
  });

  it("rolls back once when the request throws (weak signal)", async () => {
    const r = rig();
    const out = await runOptimistic({
      apply: r.apply,
      rollback: r.rollback,
      commit: async () => {
        throw new Error("Failed to fetch");
      },
      failed: serverActionError,
      fallback: "Could not save.",
    });
    assert.equal(r.state, "before");
    assert.deepEqual(r.log, ["apply", "rollback"]);
    assert.deepEqual(out, { ok: false, error: OPTIMISTIC_OFFLINE_ERROR });
  });

  it("serverActionError reads the shapes Desk actions return", () => {
    assert.equal(serverActionError({ ok: true }), null);
    assert.equal(serverActionError({ ok: true, archived: false }), null);
    assert.equal(serverActionError({ error: "Nope" }), "Nope");
    assert.equal(serverActionError({ ok: false }), "");
    assert.equal(serverActionError(undefined), null);
  });
});

describe("D1 wiring: optimistic Archive, Done, Pin, Favourite", () => {
  it("row menu hides or pins the row before awaiting the server and rolls back on failure", () => {
    const src = read("dashboard/src/components/InboxRowOverflow.tsx");
    assert.match(src, /runOptimistic\(/);
    assert.match(src, /patch\(\{ hidden: true \}\)/);
    assert.match(src, /patch\(\{ hidden: false \}\)/);
    assert.match(src, /tone: "error"/);
    assert.match(src, /label: "Try again"/);
  });

  it("bulk bar hides every chosen row first and brings back rows the server did not change", () => {
    const src = read("dashboard/src/components/InboxRowSelect.tsx");
    assert.match(src, /hideNow/);
    assert.match(src, /hidden: false/);
  });

  it("ticket Done and Favourite use useOptimistic and keep their role gates", () => {
    const dock = read("dashboard/src/components/InboxTicketActionDock.tsx");
    assert.match(dock, /useOptimistic/);
    assert.match(dock, /withRoleGate\("inbox\.act"/);
    const fav = read("dashboard/src/components/ContactFavouriteButton.tsx");
    assert.match(fav, /useOptimistic/);
    assert.match(fav, /withRoleGate\("contacts\.edit"/);
  });

  it("server actions still check membership (no contract change)", () => {
    const calls = read("dashboard/src/app/(desk)/calls/actions.ts");
    assert.match(calls, /memberDenied\("inbox\.act"\)/);
  });
});
