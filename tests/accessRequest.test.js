const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

describe("request access sign-up", () => {
  const actions = read("dashboard/src/app/signup/actions.ts");
  const requestForm = read("dashboard/src/app/signup/RequestAccessForm.tsx");
  const signupMode = read("dashboard/src/lib/signupMode.ts");
  const landing = read("dashboard/src/components/marketing/LandingPage.tsx");
  const adminActions = read("dashboard/src/app/admin/(console)/access-requests/actions.ts");
  const sql = read("docs/supabase/access_requests.sql");

  it("gates legacy signUp behind SIGNUP_MODE open", () => {
    assert.match(actions, /isOpenSignupEnabled/);
    assert.match(actions, /Self sign-up is closed/);
    assert.match(actions, /signUp\(/);
    assert.match(signupMode, /SIGNUP_MODE \|\| "open"/);
    assert.match(signupMode, /signupCtaLabel/);
  });

  it("stores access requests via service role with honeypot and dedupe", () => {
    const logic = read("dashboard/src/lib/accessRequestLogic.ts");
    assert.match(actions, /requestAccessAction/);
    assert.match(actions, /getSupabaseAdmin/);
    assert.match(logic, /company_website/);
    assert.match(logic, /normalizeKenyaPhone/);
    assert.match(actions, /rateLimitAccessRequest/);
    assert.match(actions, /\.eq\("status", "pending"\)/);
    assert.match(requestForm, /requestAccessAction/);
    assert.match(requestForm, /Thanks, we/);
  });

  it("uses signup CTA helper on marketing and request access form", () => {
    assert.match(landing, /signupCtaLabel/);
    assert.match(requestForm, /Request access/);
    assert.doesNotMatch(landing, /Create workspace/);
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
