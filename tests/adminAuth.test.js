const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("Super Admin Better Auth", () => {
  const operators = read("dashboard/src/lib/adminOperators.ts");
  const host = read("dashboard/src/lib/adminHost.ts");
  const auth = read("dashboard/src/lib/admin-auth.ts");
  const plugin = read("dashboard/src/lib/admin-auth-plugin.ts");
  const handler = read("dashboard/src/app/api/auth/[...all]/route.ts");
  const session = read("dashboard/src/app/api/admin/session/route.ts");
  const login = read("dashboard/src/app/admin/login/page.tsx");
  const ownerLogin = read("dashboard/src/app/api/login/route.ts");
  const proxy = read("dashboard/src/proxy.ts");
  const gate = read("dashboard/src/lib/auth.ts");

  it("ships the official Better Auth Next.js handler and stateless cookie cache", () => {
    assert.match(handler, /toNextJsHandler/);
    assert.match(handler, /adminAuth/);
    assert.match(auth, /betterAuth/);
    assert.match(auth, /nextCookies/);
    assert.match(auth, /cookiePrefix: "admin"/);
    assert.match(auth, /strategy: "jwe"/);
    assert.doesNotMatch(auth, /database:/);
  });

  it("signs Super Admin in with username plus access code, not email", () => {
    assert.match(plugin, /sign-in\/access-code/);
    assert.match(plugin, /verifyAdminAccess/);
    assert.match(operators, /ADMIN_OPERATORS/);
    assert.match(operators, /ADMIN_ACCESS_CODE/);
    assert.match(operators, /ADMIN_USERNAMES/);
    assert.match(login, /name="username"/);
    assert.match(login, /Access code/);
    assert.match(login, /action="\/api\/admin\/session"/);
    assert.doesNotMatch(login, /type="email"/);
    assert.doesNotMatch(login, /—|–/);
  });

  it("keeps owner email login off the Super Admin cookie", () => {
    assert.match(ownerLogin, /admin@scalers\.local/);
    assert.match(ownerLogin, /adminLoginHref/);
    assert.doesNotMatch(ownerLogin, /sessionCookieValue/);
    assert.doesNotMatch(ownerLogin, /signInWithPassword[\s\S]*admin@scalers/);
  });

  it("splits admin.scalers.co.ke from the owner host", () => {
    assert.match(host, /admin\.scalers\.co\.ke/);
    assert.match(host, /ADMIN_HOST/);
    assert.match(proxy, /configuredAdminHost/);
    assert.match(proxy, /\/admin\/login/);
    assert.match(proxy, /export function proxy/);
  });

  it("reads Better Auth session before the leftover HMAC cookie", () => {
    assert.match(gate, /getAdminSession/);
    assert.match(gate, /adminAuth\.api\.getSession/);
    assert.match(gate, /isAdminAuthenticated/);
    assert.match(session, /adminAuth\.handler/);
    assert.match(session, /SESSION_COOKIE/);
  });
});
