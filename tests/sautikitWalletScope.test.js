"use strict";

// getSautikitWallet keeps its null fallback on 403 / api_key.scope_denied but
// must log one server-side warning (status, code, wallet.read hint), never the key.

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SRC = pathToFileURL(path.join(ROOT, "dashboard/src/")).href;
const sautikitPath = path.join(ROOT, "dashboard/src/lib/sautikit.ts");

// Resolve the dashboard "@/..." alias for this child process only.
const HOOK = `
  export async function resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) {
      const rel = specifier.slice(2);
      return next(new URL(/\\.[a-z]+$/i.test(rel) ? rel : rel + ".ts", ${JSON.stringify(SRC)}).href, context);
    }
    return next(specifier, context);
  }
`;

const FAKE_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJzY29wZXMiOlsibnVtYmVycy5yZWFkIl19.SECRET-SIGNATURE-123";

function run(body) {
  const script = `
    import { register } from "node:module";
    register("data:text/javascript," + encodeURIComponent(${JSON.stringify(HOOK)}));
    process.env.SAUTIKIT_API_KEY = ${JSON.stringify(FAKE_KEY)};
    process.env.SAUTIKIT_API_BASE = "https://sautikit.test";
    const warnings = [];
    const errors = [];
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    console.error = (...args) => errors.push(args.map(String).join(" "));
    const calls = [];
    const respond = (status, json) => async (url, init) => {
      calls.push({ url: String(url), auth: init?.headers?.Authorization || null });
      return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
    };
    const m = await import(${JSON.stringify(pathToFileURL(sautikitPath).href)});
    ${body}
  `;
  const ran = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 0, ran.stderr || ran.stdout);
  return JSON.parse(ran.stdout.trim().split("\n").at(-1));
}

describe("getSautikitWallet scope denial", () => {
  it("returns null and logs status, code and the wallet.read hint on 403 scope_denied", () => {
    const got = run(`
      globalThis.fetch = respond(403, { error: { code: "api_key.scope_denied", message: "Missing scope wallet.read" } });
      const wallet = await m.getSautikitWallet();
      console.log(JSON.stringify({ wallet, warnings, errors, calls }));
    `);
    assert.equal(got.wallet, null);
    assert.equal(got.calls.length, 1);
    assert.equal(got.calls[0].url, "https://sautikit.test/v1/wallet");
    assert.equal(got.errors.length, 0);
    assert.equal(got.warnings.length, 1);
    const line = got.warnings[0];
    assert.match(line, /^\[sautikit:wallet\]/);
    assert.match(line, /HTTP 403/);
    assert.match(line, /api_key\.scope_denied/);
    assert.match(line, /wallet\.read/);
    assert.ok(!line.includes(FAKE_KEY), "warning must not contain the key");
    assert.ok(!line.includes("SECRET-SIGNATURE"), "warning must not contain any key fragment");
    assert.ok(!line.includes("eyJ"), "warning must not contain any key fragment");
  });

  it("still logs on a bare 403 without an error code", () => {
    const got = run(`
      globalThis.fetch = respond(403, {});
      const wallet = await m.getSautikitWallet();
      console.log(JSON.stringify({ wallet, warnings }));
    `);
    assert.equal(got.wallet, null);
    assert.equal(got.warnings.length, 1);
    assert.match(got.warnings[0], /HTTP 403, no code/);
    assert.match(got.warnings[0], /wallet\.read/);
  });

  it("returns the wallet without warnings on 200", () => {
    const got = run(`
      globalThis.fetch = respond(200, { balance_minor: 1181, currency: "KES" });
      const wallet = await m.getSautikitWallet();
      console.log(JSON.stringify({ wallet, warnings }));
    `);
    assert.deepEqual(got.wallet, { balance_minor: 1181, currency: "KES" });
    assert.deepEqual(got.warnings, []);
  });

  it("rethrows other failures without the scope warning", () => {
    const got = run(`
      globalThis.fetch = respond(500, { error: { code: "internal", message: "boom" } });
      let thrown = null;
      try { await m.getSautikitWallet(); } catch (err) { thrown = { message: err.message, status: err.status }; }
      console.log(JSON.stringify({ thrown, warnings }));
    `);
    assert.equal(got.thrown.status, 500);
    assert.deepEqual(got.warnings, []);
  });
});
