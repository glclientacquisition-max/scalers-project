import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  buildAccessRequestRepeatCounts,
  countAccessRequestsByStatus,
  filterAccessRequestsByStatus,
  matchesAccessRequestSearch,
  parseAccessRequestStatusFilter,
  telHrefForAccess,
  waMeHrefForAccess,
} from "../dashboard/src/lib/accessRequestLogic.ts";
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

  it("normalizes Kenyan phone for tel and wa.me", () => {
    assert.equal(telHrefForAccess("0712345678"), "tel:+254712345678");
    assert.equal(waMeHrefForAccess("0712345678"), "https://wa.me/254712345678");
    assert.equal(waMeHrefForAccess("+254 712 345 678"), "https://wa.me/254712345678");
    assert.equal(waMeHrefForAccess("invalid"), null);
  });

  it("filters by status and searches fields", () => {
    const rows = [
      {
        id: "1",
        status: "pending" as const,
        created_at: "2026-01-02",
        name: "Jane",
        business: "Acme",
        phone: "+254712345678",
        email: "jane@acme.co.ke",
        about: "Plumbing",
      },
      {
        id: "2",
        status: "approved" as const,
        created_at: "2026-01-01",
        name: "John",
        business: "Beta Shop",
        phone: "+254700000001",
        email: "john@beta.com",
        about: "Retail",
      },
    ];

    assert.equal(parseAccessRequestStatusFilter("pending"), "pending");
    assert.equal(parseAccessRequestStatusFilter(""), "all");

    const pending = filterAccessRequestsByStatus(rows, "pending");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, "1");

    assert.equal(matchesAccessRequestSearch(rows[0], "acme"), true);
    assert.equal(matchesAccessRequestSearch(rows[0], "beta"), false);
    assert.equal(matchesAccessRequestSearch(rows[0], "254712"), true);

    const counts = countAccessRequestsByStatus(rows);
    assert.equal(counts.pending, 1);
    assert.equal(counts.approved, 1);
    assert.equal(counts.declined, 0);
  });

  it("flags repeat requests by phone or email", () => {
    const rows = [
      {
        id: "a",
        phone: "0711111111",
        email: "one@example.com",
      },
      {
        id: "b",
        phone: "0722222222",
        email: "one@example.com",
      },
      {
        id: "c",
        phone: "0711111111",
        email: "two@example.com",
      },
    ];
    const counts = buildAccessRequestRepeatCounts(rows);
    assert.equal(counts.a, 3);
    assert.equal(counts.b, 2);
    assert.equal(counts.c, 2);
  });
});
