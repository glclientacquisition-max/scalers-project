// PR 6 (30 Oct): website import fetch is https-only, port 443, pinned to the checked address, robots.txt aware.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedIp, isReadableContentType, robotsDisallows, safeLookup, fetchPublicUrlSafe } from "../dashboard/src/lib/ingest/ssrfFetch.ts";

test("blocks private, mapped, NAT64 and multicast addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "ff02::1", "2001:db8::1"]) {
    assert.equal(isBlockedIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isBlockedIp(ip), false, ip);
});

test("reads only HTML and plain text", () => {
  assert.equal(isReadableContentType("text/html; charset=utf-8"), true);
  assert.equal(isReadableContentType("text/plain"), true);
  assert.equal(isReadableContentType("application/json"), false);
  assert.equal(isReadableContentType("application/xml"), false);
  assert.equal(isReadableContentType("image/png"), false);
});

test("robots.txt groups", () => {
  assert.equal(robotsDisallows("User-agent: *\nDisallow: /", "/menu"), true);
  assert.equal(robotsDisallows("User-agent: *\nDisallow: /admin", "/menu"), false);
  assert.equal(robotsDisallows("User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /", "/"), false);
  assert.equal(robotsDisallows("", "/"), false);
});

test("pinned lookup refuses a host that resolves privately", async () => {
  const err = await new Promise<Error | null>((r) => safeLookup("localhost", {}, (e) => r(e)));
  assert.ok(err);
});

test("rejects ports, credentials, other schemes and local hosts before any request", async () => {
  await assert.rejects(fetchPublicUrlSafe("https://example.com:8443/"), /port/);
  await assert.rejects(fetchPublicUrlSafe("https://u:p@example.com/"), /usernames/);
  await assert.rejects(fetchPublicUrlSafe("ftp://example.com/"), /https/);
  await assert.rejects(fetchPublicUrlSafe("http://localhost/"), /local address/);
  await assert.rejects(fetchPublicUrlSafe("https://169.254.169.254/latest"), /private/);
});
