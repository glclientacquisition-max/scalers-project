import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  rateLimitAccessRequest,
  resetAccessRequestRateLimit,
} from "../dashboard/src/lib/accessRequestRateLimit.ts";
import { getSignupMode } from "../dashboard/src/lib/signupMode.ts";

describe("access request logic", () => {
  beforeEach(() => {
    process.env.SIGNUP_MODE = "request";
    resetAccessRequestRateLimit();
  });

  afterEach(() => {
    delete process.env.SIGNUP_MODE;
    resetAccessRequestRateLimit();
  });

  it("defaults SIGNUP_MODE to open", () => {
    delete process.env.SIGNUP_MODE;
    assert.equal(getSignupMode(), "open");
    process.env.SIGNUP_MODE = "request";
    assert.equal(getSignupMode(), "request");
  });

  it("rate limits by client key", () => {
    assert.equal(rateLimitAccessRequest("test-ip"), false);
    for (let i = 0; i < 10; i++) rateLimitAccessRequest("test-ip");
    assert.equal(rateLimitAccessRequest("test-ip"), true);
  });
});
