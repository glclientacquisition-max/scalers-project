const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("request access sign-up", () => {
  const actions = read("dashboard/src/app/signup/actions.ts");
  const form = read("dashboard/src/app/signup/SignupForm.tsx");
  const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
  const adminActions = read("dashboard/src/app/admin/(console)/access-requests/actions.ts");
  const sql = read("docs/supabase/access_requests.sql");

  it("gates legacy signUp behind SIGNUP_MODE open", () => {
    assert.match(actions, /isOpenSignupEnabled/);
    assert.match(actions, /Self sign-up is closed/);
    assert.match(actions, /signUp\(/);
  });

  it("stores access requests via service role with honeypot and dedupe", () => {
    const logic = read("dashboard/src/lib/accessRequestLogic.ts");
    assert.match(actions, /requestAccessAction/);
    assert.match(actions, /getSupabaseAdmin/);
    assert.match(logic, /company_website/);
    assert.match(logic, /normalizeKenyaPhone/);
    assert.match(actions, /rateLimitAccessRequest/);
    assert.match(actions, /\.eq\("status", "pending"\)/);
    assert.match(form, /requestAccessAction/);
    assert.match(form, /Thanks, we/);
  });

  it("uses Request access CTAs on marketing and form", () => {
    assert.match(landing, /Request access/);
    assert.doesNotMatch(landing, /Create workspace/);
    assert.match(form, /Request access/);
  });

  it("approve and decline admin actions invite by email", () => {
    assert.match(adminActions, /inviteUserByEmail/);
    assert.match(adminActions, /declineAccessRequestAction/);
    assert.match(adminActions, /isAdminV2Enabled/);
  });

  it("ships access_requests SQL with RLS and no public policies", () => {
    assert.match(sql, /access_requests/);
    assert.match(sql, /enable row level security/);
    assert.doesNotMatch(sql, /to anon/);
    assert.doesNotMatch(sql, /to authenticated/);
  });
});
