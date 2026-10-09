"use strict";

// Supabase/PostgREST return plain { message, code, details, hint } objects, not
// Error instances. Missing ops tables must be detected and logged from those.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const helperPath = path.join(ROOT, "dashboard/src/lib/adminErrors.ts");

function run(body) {
  const script = `
    import * as m from ${JSON.stringify(helperPath)};
    ${body}
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

const PGRST205 = {
  code: "PGRST205",
  details: null,
  hint: "Perhaps you meant the table 'public.platform_settings'",
  message: "Could not find the table 'public.platform_ops_settings' in the schema cache",
};
const PG_42P01 = {
  code: "42P01",
  details: null,
  hint: null,
  message: 'relation "public.platform_ops_notices" does not exist',
};

describe("admin missing-table detection", () => {
  it("matches plain PostgREST error objects by code and message", () => {
    const got = run(`
      console.log(JSON.stringify([
        m.isMissingTableError(${JSON.stringify(PGRST205)}),
        m.isMissingTableError(${JSON.stringify(PG_42P01)}),
        m.isMissingTableError({ code: "PGRST205" }),
        m.isMissingTableError({ code: "42P01", message: "" }),
        m.isMissingTableError({ message: 'relation "platform_ops_settings" does not exist' }),
        m.isMissingTableError({ message: "Could not find the table 'public.platform_ops_notices' in the schema cache" }),
        m.isMissingTableError(new Error('relation "platform_ops_notices" does not exist')),
      ]));
    `);
    assert.deepEqual(got, [true, true, true, true, true, true, true]);
  });

  it("does not treat other database errors as a missing table", () => {
    const got = run(`
      console.log(JSON.stringify([
        m.isMissingTableError({ code: "23505", message: "duplicate key value violates unique constraint" }),
        m.isMissingTableError({ code: "42501", message: "permission denied for table tenants" }),
        m.isMissingTableError(new Error("fetch failed")),
        m.isMissingTableError(null),
        m.isMissingTableError(undefined),
        m.isMissingTableError("[object Object]"),
      ]));
    `);
    assert.deepEqual(got, [false, false, false, false, false, false]);
  });

  it("extracts message and code from plain objects and Errors", () => {
    const got = run(`
      const coded = Object.assign(new Error("boom"), { code: "E_X" });
      console.log(JSON.stringify([
        m.adminErrorParts(${JSON.stringify(PGRST205)}),
        m.adminErrorParts(coded),
        m.adminErrorParts("plain text"),
        m.adminErrorParts({ details: "only details" }),
      ]));
    `);
    assert.deepEqual(got, [
      { message: PGRST205.message, code: "PGRST205" },
      { message: "boom", code: "E_X" },
      { message: "plain text", code: null },
      { message: '{"details":"only details"}', code: null },
    ]);
  });
});

describe("logAdminError", () => {
  it("prints the real message and code instead of [object Object]", () => {
    const got = run(`
      const lines = [];
      console.error = (...args) => lines.push(args.map(String).join(" "));
      m.logAdminError("overview", ${JSON.stringify(PGRST205)});
      m.logAdminError("platform", ${JSON.stringify(PG_42P01)});
      m.logAdminError("voices", new Error("plain failure"));
      m.logAdminError("numbers", { code: "PGRST205" });
      console.log(JSON.stringify(lines));
    `);
    assert.deepEqual(got, [
      `[admin:overview] ${PGRST205.message} [PGRST205]`,
      `[admin:platform] ${PG_42P01.message} [42P01]`,
      "[admin:voices] plain failure",
      "[admin:numbers] (no message) [PGRST205]",
    ]);
    for (const line of got) assert.doesNotMatch(line, /\[object Object\]/);
  });
});

describe("platform ops missing-table fallback wiring", () => {
  const src = fs.readFileSync(path.join(ROOT, "dashboard/src/lib/platformOps.ts"), "utf8");

  it("uses the plain-object-aware detector, not instanceof Error", () => {
    assert.match(src, /isMissingTableError\(err\)/);
    assert.doesNotMatch(src, /function isMissingTable[\s\S]{0,200}instanceof Error/);
  });

  it("skips notice writes and mail when the notices table is missing", () => {
    // Page loads never write notices; the scheduled check skips the run when the table is missing.
    assert.doesNotMatch(src, /\.insert\(|sendOpsMail/);
    const cron = fs.readFileSync(path.join(ROOT, "dashboard/src/lib/opsAlerts.ts"), "utf8");
    assert.match(cron, /if \(!isMissingTableError\(probe\.error\)\) throw probe\.error;/);
    assert.match(cron, /platform_ops_notices missing; skipping/);
  });
});

describe("PhonePullSurface SSR", () => {
  it("does not evaluate HTMLElement during render", () => {
    const src = fs.readFileSync(path.join(ROOT, "dashboard/src/components/PhonePullSurface.tsx"), "utf8");
    const render = src.slice(src.indexOf("return (\n    <div data-pull-host"));
    assert.ok(render.length > 0);
    assert.doesNotMatch(render.slice(0, render.indexOf("export function DeskPhonePull")), /instanceof HTMLElement/);
  });
});
