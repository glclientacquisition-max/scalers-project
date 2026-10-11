/** Run: node --experimental-strip-types --test tests/authCallback.test.ts */
import assert from "node:assert/strict";
import { it } from "node:test";
import { callbackFailurePath, requestOrigin, safeNext, signupConfirmUrl } from "../dashboard/src/lib/authCallback.ts";
import { signupErrorMessage } from "../dashboard/src/lib/signupErrors.ts";

it("only allows same-site next paths", () => {
  assert.equal(safeNext("/onboarding?step=hours"), "/onboarding?step=hours");
  for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "/a\r\nb", ""]) assert.equal(safeNext(bad), "/onboarding", bad);
});
it("builds the confirm link from the request origin", () => {
  const h: Record<string, string> = { "x-forwarded-host": "scalers-staging.vercel.app", "x-forwarded-proto": "https" };
  const origin = requestOrigin((n) => h[n]);
  assert.equal(origin, "https://scalers-staging.vercel.app");
  assert.equal(signupConfirmUrl(origin), "https://scalers-staging.vercel.app/auth/callback?next=%2Fonboarding");
  assert.equal(requestOrigin((n) => (n === "host" ? "localhost:3020" : null)), "http://localhost:3020");
});
it("sends failed links to sign-in with the right note", () => {
  assert.equal(callbackFailurePath("otp_expired"), "/login?link=expired");
  assert.equal(callbackFailurePath(null), "/login?link=confirmed");
});
it("maps Supabase auth errors to plain copy", () => {
  assert.deepEqual(signupErrorMessage("User already registered"), { message: "This email already has an account.", field: "email", signIn: true });
  assert.equal(signupErrorMessage("email rate limit exceeded").field, undefined);
  assert.equal(signupErrorMessage("Password should be at least 8 characters").field, "password");
  assert.equal(signupErrorMessage("weird").message, "Something went wrong. Try again.");
});
