const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("desk Auth env fallback", () => {
  it("prefers server SUPABASE_URL and skips blank public inlining", () => {
    const env = read("dashboard/src/lib/supabase/env.ts");
    const urlFn = env.slice(
      env.indexOf("export function getSupabaseUrl"),
      env.indexOf("export function getSupabaseAnonKey")
    );
    assert.match(urlFn, /nonempty\(process\.env\.SUPABASE_URL\)/);
    assert.match(urlFn, /nonempty\(process\.env\.NEXT_PUBLIC_SUPABASE_URL\)/);
    assert.ok(
      urlFn.indexOf("process.env.SUPABASE_URL") <
        urlFn.indexOf("process.env.NEXT_PUBLIC_SUPABASE_URL")
    );
    assert.match(env, /value\.trim\(\)/);
  });

  it("accepts anon or publishable keys for Auth", () => {
    const env = read("dashboard/src/lib/supabase/env.ts");
    const keyFn = env.slice(env.indexOf("export function getSupabaseAnonKey"));
    assert.match(keyFn, /SUPABASE_ANON_KEY/);
    assert.match(keyFn, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.match(keyFn, /SUPABASE_PUBLISHABLE_KEY/);
    assert.match(keyFn, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.ok(
      keyFn.indexOf("process.env.SUPABASE_ANON_KEY") <
        keyFn.indexOf("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    );
  });

  it("keeps login config errors owner-facing", () => {
    const login = read("dashboard/src/app/login/page.tsx");
    const route = read("dashboard/src/app/api/login/route.ts");
    const signup = read("dashboard/src/app/signup/actions.ts");
    assert.match(login, /Sign in is not available/);
    assert.match(route, /error=config/);
    assert.match(signup, /Sign up is not available/);
    assert.doesNotMatch(signup, /NEXT_PUBLIC_SUPABASE/);
  });
});
