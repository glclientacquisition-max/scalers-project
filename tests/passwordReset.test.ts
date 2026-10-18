/** Run: node --experimental-strip-types --test tests/passwordReset.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { callbackFailurePath, isResetNext, resetPasswordRedirectUrl } from "../dashboard/src/lib/authCallback.ts";
import {
  PASSWORD_UPDATED_PATH,
  RECOVERY_COOKIE_SECONDS,
  newPasswordError,
  recoveryCookieOptions,
  updatePasswordErrorMessage,
} from "../dashboard/src/lib/passwordReset.ts";

const src = (p: string) => readFileSync(new URL(`../dashboard/src/${p}`, import.meta.url), "utf8");

it("reset links come back through /auth/callback to the new password page", () => {
  assert.equal(resetPasswordRedirectUrl("https://app.scalers.co.ke/"), "https://app.scalers.co.ke/auth/callback?next=%2Freset-password");
  assert.ok(isResetNext("/reset-password"));
  assert.ok(isResetNext("/reset-password?x=1"));
  assert.ok(!isResetNext("/reset-passwordx"));
  assert.ok(!isResetNext("/onboarding"));
});

it("a failed reset link lands on the send-a-new-link state, signup links are unchanged", () => {
  assert.equal(callbackFailurePath("otp_expired", "/reset-password"), "/reset-password?link=expired");
  assert.equal(callbackFailurePath(null, "/reset-password"), "/reset-password?link=invalid");
  assert.equal(callbackFailurePath("otp_expired"), "/login?link=expired");
  assert.equal(callbackFailurePath(null, "/onboarding"), "/login?link=confirmed");
});

it("new password follows the signup rules and must match", () => {
  assert.equal(newPasswordError("short", "short")?.field, "password");
  assert.equal(newPasswordError("x".repeat(73), "x".repeat(73))?.field, "password");
  assert.deepEqual(newPasswordError("longenough1", "longenough2"), { field: "confirm", message: "The two passwords don't match." });
  assert.equal(newPasswordError("longenough1", "longenough1"), null);
});

it("maps Supabase updateUser errors to plain copy", () => {
  assert.equal(updatePasswordErrorMessage("New password should be different from the old password.").field, "password");
  assert.equal(updatePasswordErrorMessage("Auth session missing!").field, undefined);
  assert.match(updatePasswordErrorMessage("Auth session missing!").message, /expired/);
  assert.equal(updatePasswordErrorMessage("boom").message, "Couldn't save your new password. Try again.");
});

it("recovery marker is short lived and not readable by scripts", () => {
  assert.equal(recoveryCookieOptions.httpOnly, true);
  assert.equal(recoveryCookieOptions.maxAge, RECOVERY_COOKIE_SECONDS);
  assert.ok(RECOVERY_COOKIE_SECONDS <= 30 * 60);
  assert.equal(PASSWORD_UPDATED_PATH, "/home?notice=password-updated");
});

it("callback accepts recovery links and sets the marker only for reset", () => {
  const route = src("app/auth/callback/route.ts");
  assert.match(route, /"recovery"/);
  assert.match(route, /signedIn && isResetNext\(next\)/);
  assert.match(route, /callbackFailurePath\(supabaseError, next\)/);
});

it("forgot password never says whether an account exists", () => {
  const action = src("app/forgot-password/actions.ts");
  assert.match(action, /resetPasswordForEmail\(email, \{\s*redirectTo: resetPasswordRedirectUrl/);
  assert.match(action, /return \{ sent: true, email \};/);
  assert.doesNotMatch(action, /no account|not found|doesn't exist|isn't registered/i);
  assert.match(action, /reset:email:\$\{email\}/);
  const form = src("app/forgot-password/ForgotPasswordForm.tsx");
  assert.match(form, /If <span[^>]*>\{state\.email\}<\/span> has a Scalers account/);
});

it("reset page needs a recovery session and offers a new link otherwise", () => {
  const action = src("app/reset-password/actions.ts");
  assert.match(action, /jar\.get\(RECOVERY_COOKIE\)/);
  assert.match(action, /updateUser\(\{ password \}\)/);
  assert.match(action, /redirect\(PASSWORD_UPDATED_PATH\)/);
  const form = src("app/reset-password/ResetPasswordForm.tsx");
  assert.match(form, /href="\/forgot-password"[\s\S]*Send a new link/);
  assert.match(src("components/WelcomeToast.tsx"), /PASSWORD_UPDATED_NOTICE/);
});

it("sign in and invite pages link to the reset page", () => {
  assert.match(src("app/login/page.tsx"), /href="\/forgot-password"[\s\S]*Forgot password\?/);
  const invite = src("app/invite/[token]/InviteForms.tsx");
  assert.match(invite, /\/forgot-password\?email=\$\{encodeURIComponent\(email\)\}/);
  assert.doesNotMatch(invite, /Reset it from the/);
});

it("owner copy has no dashes", () => {
  const files = [
    "app/forgot-password/ForgotPasswordForm.tsx",
    "app/forgot-password/page.tsx",
    "app/reset-password/ResetPasswordForm.tsx",
    "app/reset-password/page.tsx",
  ];
  for (const f of files) {
    const text = src(f).replace(/className=("[^"]*"|\{`[^`]*`\})/g, "");
    const jsxText = text.match(/>[^<>{}]+</g) || [];
    for (const t of jsxText) assert.doesNotMatch(t, /[\u2013\u2014]| - /, `${f}: ${t}`);
  }
});
