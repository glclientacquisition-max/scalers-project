/**
 * Super Admin data leak guard.
 * Signed-out requests must be stopped before any admin data loads:
 * the proxy redirects with no body, and every page and loader calls requireSuperAdmin() first.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ADMIN_CACHE_CONTROL,
  ADMIN_LOGIN_PATH,
  adminGateRedirect,
  hasAdminSessionCookie,
  isGuardedAdminPath,
  isNoStoreAdminPath,
} = require("../dashboard/src/lib/adminGate.ts");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const CONSOLE = "dashboard/src/app/admin/(console)";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (entry.name === "page.tsx" || entry.name === "layout.tsx") out.push(rel);
  }
  return out;
}

/** Body of the default export, from its opening brace. */
function defaultExportBody(src) {
  const start = src.search(/export default (async )?function/);
  assert.ok(start >= 0, "no default export function");
  const sig = src.indexOf(") {", start);
  return src.slice(sig + 3);
}

/** The first statement in `body` that reads anything: an await, a try, or a loader call. */
function firstStatement(body) {
  return body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("//"));
}

describe("adminGate (proxy, before any page code)", () => {
  it("sends a signed-out request for every admin page to the admin login", () => {
    for (const p of ["/admin", "/admin/businesses", "/admin/billing", "/admin/numbers", "/admin/billing/abc", "/admin/platform"]) {
      assert.equal(adminGateRedirect(p, []), ADMIN_LOGIN_PATH, p);
    }
  });

  it("an owner desk session alone is not a Super Admin session", () => {
    const owner = ["sb-abc-auth-token", "sb-abc-auth-token.0", "desk_theme"];
    assert.equal(hasAdminSessionCookie(owner), false);
    assert.equal(adminGateRedirect("/admin/businesses", owner), ADMIN_LOGIN_PATH);
  });

  it("lets a request with an admin cookie through to the server check", () => {
    for (const c of ["admin.session_token", "__Secure-admin.session_token", "__Secure-admin.session_data", "scalers_session", "sauti_desk_session"]) {
      assert.equal(adminGateRedirect("/admin/numbers", [c]), null, c);
    }
  });

  it("never gates the login screen, owner routes or lookalike paths", () => {
    assert.equal(adminGateRedirect("/admin/login", []), null);
    assert.equal(adminGateRedirect("/home", []), null);
    assert.equal(adminGateRedirect("/administrator", []), null);
    assert.equal(isGuardedAdminPath("/admin-tools"), false);
  });

  it("leaves DASHBOARD_OPEN local dev to the server check", () => {
    assert.equal(adminGateRedirect("/admin/businesses", [], true), null);
  });

  it("marks admin pages and admin JSON routes no-store", () => {
    for (const p of ["/admin", "/admin/businesses", "/admin/login", "/api/admin/billing", "/api/did-pool"]) {
      assert.equal(isNoStoreAdminPath(p), true, p);
    }
    assert.equal(isNoStoreAdminPath("/home"), false);
    assert.match(ADMIN_CACHE_CONTROL, /private/);
    assert.match(ADMIN_CACHE_CONTROL, /no-store/);
  });

  it("is wired into the proxy on the admin host and the shared host", () => {
    const proxy = read("dashboard/src/proxy.ts");
    assert.equal((proxy.match(/adminGate\(request, path\)/g) || []).length, 2);
    assert.match(proxy, /Cache-Control/);
  });
});

describe("requireSuperAdmin (server, before any data)", () => {
  const guard = read("dashboard/src/lib/adminGuard.ts");

  it("opts out of prerendering, checks the admin session, then redirects", () => {
    const conn = guard.indexOf("await connection()");
    const check = guard.indexOf("isAdminAuthenticated()");
    const redirect = guard.indexOf("redirect(ADMIN_LOGIN_PATH)");
    assert.ok(conn > 0 && check > conn && redirect > check);
    assert.doesNotMatch(guard, /"\/home"/);
  });

  const files = walk(CONSOLE);

  it("covers every page and the layout under admin/(console)", () => {
    assert.ok(files.length >= 11, `found ${files.length}`);
    assert.ok(files.some((f) => f.endsWith("layout.tsx")));
  });

  for (const rel of files) {
    it(`${rel.replace(CONSOLE, "")} calls the guard first, outside try/catch`, () => {
      const src = read(rel);
      assert.match(src, /import \{ requireSuperAdmin \} from "@\/lib\/adminGuard";/);
      const body = defaultExportBody(src);
      assert.equal(firstStatement(body), "await requireSuperAdmin();");
      const guardAt = body.indexOf("await requireSuperAdmin()");
      const tryAt = body.indexOf("try {");
      if (tryAt >= 0) assert.ok(guardAt < tryAt, "guard must not sit inside try/catch");
      const otherAwait = body.indexOf("await ", guardAt + 1);
      if (otherAwait >= 0) assert.ok(guardAt < otherAwait);
      assert.doesNotMatch(src, /export const (dynamic|revalidate) = /, "cacheComponents rejects these; connection() in the guard does the job");
    });
  }

  for (const [rel, fn] of [
    ["dashboard/src/lib/admin.ts", "getAdminOverview"],
    ["dashboard/src/lib/platformOps.ts", "evaluatePlatformOps"],
  ]) {
    it(`${fn} guards itself before reading data`, () => {
      const src = read(rel);
      const start = src.indexOf(`export async function ${fn}(`);
      assert.ok(start >= 0);
      const body = src.slice(start);
      assert.equal(body.indexOf("await "), body.indexOf("await requireSuperAdmin();"), "first await is the guard");
      assert.ok(body.indexOf("await requireSuperAdmin();") < body.indexOf("getSupabaseAdmin()") || !body.includes("getSupabaseAdmin()"));
    });
  }

  it("adminBilling.ts stays client-importable; its page and API route guard instead", () => {
    // AdminBillingDetailPanel (client) imports labels from adminBilling.ts, so it cannot pull in next/headers.
    assert.doesNotMatch(read("dashboard/src/lib/adminBilling.ts"), /adminGuard|next\/headers/);
  });

  it("every admin JSON route checks the session before it reads", () => {
    const apiDir = "dashboard/src/app/api/admin";
    for (const name of fs.readdirSync(path.join(root, apiDir))) {
      if (name === "session") continue;
      const src = read(`${apiDir}/${name}/route.ts`);
      const handlers = src.split(/export async function (?:GET|POST|PUT|PATCH|DELETE)\b/).slice(1);
      assert.ok(handlers.length > 0, name);
      for (const h of handlers) {
        assert.equal(firstStatement(h.slice(h.indexOf("{\n") + 2)), "if (!(await isLegacyAuthenticated())) {", name);
      }
    }
  });
});
