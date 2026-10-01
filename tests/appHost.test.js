const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  appHostRedirect,
  hostOnlyCookieOptions,
  marketingHomeHref,
  ownerAuthRedirectUrl,
} = require("../dashboard/src/lib/adminHost.ts");

const split = {
  APP_HOST: "app.scalers.co.ke",
  NEXT_PUBLIC_SITE_URL: "https://www.scalers.co.ke",
  ADMIN_HOST: "admin.scalers.co.ke",
};

describe("app host split", () => {
  it("sends desk paths on www and the apex to the app host", () => {
    assert.deepEqual(appHostRedirect("www.scalers.co.ke", "/calls/abc", split), {
      host: "app.scalers.co.ke",
      pathname: "/calls/abc",
    });
    assert.deepEqual(appHostRedirect("scalers.co.ke", "/login", split), {
      host: "app.scalers.co.ke",
      pathname: "/login",
    });
    assert.deepEqual(appHostRedirect("www.scalers.co.ke", "/api/tenant", split), {
      host: "app.scalers.co.ke",
      pathname: "/api/tenant",
    });
  });

  it("leaves marketing on the site host", () => {
    assert.equal(appHostRedirect("www.scalers.co.ke", "/", split), null);
    assert.equal(appHostRedirect("scalers.co.ke", "/", split), null);
  });

  it("sends the app host root to sign-in", () => {
    assert.deepEqual(appHostRedirect("app.scalers.co.ke", "/", split), {
      host: "app.scalers.co.ke",
      pathname: "/login",
    });
    assert.equal(appHostRedirect("app.scalers.co.ke", "/home", split), null);
  });

  it("does not split when the app host is the site host", () => {
    const same = {
      APP_HOST: "www.scalers.co.ke",
      NEXT_PUBLIC_SITE_URL: "https://www.scalers.co.ke",
    };
    assert.equal(appHostRedirect("www.scalers.co.ke", "/home", same), null);
    assert.equal(marketingHomeHref({}), "/");
    assert.equal(ownerAuthRedirectUrl({}), undefined);
  });

  it("does not move the admin host", () => {
    assert.equal(appHostRedirect("admin.scalers.co.ke", "/login", split), null);
    assert.equal(appHostRedirect("localhost", "/home", split), null);
  });

  it("points desk home links at marketing and keeps cookies host-only", () => {
    assert.equal(marketingHomeHref(split), "https://www.scalers.co.ke/");
    assert.equal(ownerAuthRedirectUrl(split), "https://app.scalers.co.ke/login");
    const options = hostOnlyCookieOptions({
      path: "/",
      domain: ".scalers.co.ke",
      httpOnly: true,
    });
    assert.equal("domain" in options, false);
    assert.equal(options.path, "/");
    assert.equal(options.httpOnly, true);
  });
});
