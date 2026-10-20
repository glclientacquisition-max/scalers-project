/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const crypto = require("node:crypto");
const { fromCents, toCents } = require("./money");
const { signBachsBody } = require("./signature");

const SANDBOX_API = "https://sandbox-api.bachs.io";
const LIVE_API = "https://api.bachs.io";
const PROD_REF = "fjxcdccgyhnvnnlnovcl";
const DEFAULT_EXPIRES_MINUTES = 60;
const MAX_EXPIRES_MINUTES = 1440;

function expiresInMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_EXPIRES_MINUTES;
  return Math.min(MAX_EXPIRES_MINUTES, Math.floor(n));
}

function customerBody(customer) {
  if (!customer || typeof customer !== "object") return null;
  const email = String(customer.email || "").trim();
  const name = String(customer.name || "").trim();
  const phone = String(customer.phone_number || customer.phone || "").trim();
  if (phone.startsWith("pending:")) return null;
  const out = {};
  if (email) out.email = email;
  if (name) out.name = name;
  if (phone) out.phone_number = phone;
  return Object.keys(out).length ? out : null;
}

/** Logs the Bachs error code and request id. Never logs the key or the body. */
function logBachsError(res, json) {
  const requestId = typeof res.headers?.get === "function" ? res.headers.get("x-request-id") : null;
  const errorCode = json && (json.error_code || (json.error && json.error.code)) || null;
  console.error(JSON.stringify({ source: "bachs", error_code: errorCode, request_id: requestId, status: res.status }));
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {'off' | 'sandbox' | 'live'}
 */
function bachsMode(env = process.env) {
  const raw = String(env.BACHS_MODE ?? "off").trim().toLowerCase();
  if (raw === "" || raw === "off" || raw === "mock") return "off";
  if (raw === "sandbox") return "sandbox";
  if (raw === "live") return "live";
  const err = new Error("BACHS_MODE must be off, sandbox, or live");
  err.code = "bachs_mode";
  throw err;
}

/** Exact `true`. Anything else leaves live mode closed. */
function liveAllowed(env = process.env) {
  const raw = env === process.env ? process.env.BACHS_LIVE_ALLOWED : env.BACHS_LIVE_ALLOWED;
  return String(raw || "").trim().toLowerCase() === "true";
}

function refused(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Live mode stays closed unless BACHS_LIVE_ALLOWED=true.
 * Sandbox mode still refuses a live key and the production database.
 * No request is sent when this throws.
 */
function assertBachsAllowed(env = process.env) {
  const mode = bachsMode(env);
  const key = String(env.BACHS_API_KEY || "");
  const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (mode === "live") {
    if (!liveAllowed(env)) throw refused("BACHS_MODE=live is refused", "bachs_live_refused");
    return mode;
  }
  if (key.startsWith("sk_live_")) throw refused("live Bachs keys are refused", "bachs_live_refused");
  if (url.includes(PROD_REF)) throw refused("refusing production database", "prod_refused");
  return mode;
}

/** True when checkout must not start. Does not change the gate. */
function paymentsClosed(env = process.env) {
  try {
    assertBachsAllowed(env);
    return false;
  } catch (err) {
    const code = err && err.code;
    if (code === "bachs_live_refused" || code === "prod_refused" || code === "bachs_mode") return true;
    throw err;
  }
}

/**
 * Checkout POST body. A closed gate is 503 payments_unavailable.
 * @param {unknown} err
 */
function checkoutFailure(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code || "") : "";
  if (code === "bachs_live_refused" || code === "prod_refused" || code === "bachs_mode") {
    return { status: 503, error: "payments_unavailable" };
  }
  const message = err instanceof Error ? err.message : String(err || "");
  if (code === "previous_processing" || code === "checkout_review" || message.includes("checkout total needs review")) {
    return { status: 409, error: "Previous payment still processing." };
  }
  return { status: 400, error: "Could not start payment." };
}

function allowlistRaw(env = process.env) {
  return env === process.env ? process.env.BACHS_LIVE_TENANT_ALLOWLIST : env.BACHS_LIVE_TENANT_ALLOWLIST;
}

function tenantOnEnvAllowlist(tenantId, env = process.env) {
  const raw = String(allowlistRaw(env) ?? "").trim();
  if (raw === "*") return true;
  if (!raw) return false;
  const allowed = new Set(raw.split(",").map((part) => part.trim()).filter(Boolean));
  return allowed.has(String(tenantId || "").trim());
}

function defaultLiveTenantRead(tenantId, env) {
  const { readBillingLiveTenant } = require("./liveTenant");
  return readBillingLiveTenant(tenantId, env);
}

/**
 * Live mode refuses every tenant unless the master switch is on and the
 * business is enabled in billing_live_tenants or listed in
 * BACHS_LIVE_TENANT_ALLOWLIST (`*` opens every business).
 * Unset, empty, and whitespace lists match nobody.
 * A database read error refuses the business.
 * The env list is checked first, so a listed business does not wait on the read.
 * Omitting env reads process.env. It does not skip the check.
 * @param {string} tenantId
 * @param {NodeJS.ProcessEnv} [env]
 * @param {(tenantId: string, env: NodeJS.ProcessEnv) => Promise<boolean>} [reader]
 * @returns {Promise<void>}
 */
async function assertLiveTenant(tenantId, env = process.env, reader) {
  if (bachsMode(env) !== "live") return;
  assertBachsAllowed(env);
  if (tenantOnEnvAllowlist(tenantId, env)) return;
  const read = typeof reader === "function" ? reader : defaultLiveTenantRead;
  let allowed = false;
  try {
    allowed = await read(String(tenantId || "").trim(), env);
  } catch {
    throw refused("live payments are not open for this business", "bachs_live_refused");
  }
  if (allowed === true) return;
  throw refused("live payments are not open for this business", "bachs_live_refused");
}

class MockPayProvider {
  constructor() {
    /** @type {Map<string, { checkoutId: string, checkoutUrl: string, status: string, request: object }>} */
    this.checkouts = new Map();
  }

  /**
   * @param {object} request
   */
  async createCheckout(request) {
    const checkoutId = `chk_mock_${crypto.randomBytes(9).toString("hex")}`;
    const url = new URL(request.successUrl);
    url.searchParams.set("checkout_id", checkoutId);
    const minutes = expiresInMinutes(request.expiresInMinutes);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const row = {
      checkoutId,
      checkoutUrl: url.toString(),
      status: "open",
      paymentStatus: "",
      charge: null,
      expiresAt,
      request,
    };
    this.checkouts.set(checkoutId, row);
    MockPayProvider.sessions.set(checkoutId, row);
    return { checkoutId, checkoutUrl: row.checkoutUrl, status: "open", expiresAt };
  }

  async getCheckout(checkoutId) {
    const row = this.checkouts.get(checkoutId) || MockPayProvider.sessions.get(checkoutId);
    if (!row) return null;
    if (row.unreadable) {
      const err = new Error("bachs checkout read failed");
      err.code = "bachs_checkout";
      throw err;
    }
    return {
      checkoutId: row.checkoutId,
      status: row.status || "",
      paymentStatus: row.paymentStatus || "",
      charge: row.charge || null,
    };
  }

  setStatus(checkoutId, status) {
    const row = this.checkouts.get(checkoutId);
    if (!row) throw new Error("unknown checkout");
    row.status = status;
  }

  /**
   * Builds a signed webhook body. Does not mark the invoice paid.
   * @param {string} checkoutId
   * @param {object} [opts]
   */
  paidEvent(checkoutId, opts = {}) {
    let row = this.checkouts.get(checkoutId);
    if (!row) {
      row = {
        checkoutId,
        status: "open",
        paymentStatus: "",
        charge: null,
        request: { amountKes: opts.amountKes },
      };
      this.checkouts.set(checkoutId, row);
    }
    MockPayProvider.sessions.set(checkoutId, row);
    const amountKes = opts.amountKes || row?.request?.amountKes;
    if (opts.unreadable) {
      row.unreadable = true;
    } else if (!opts.leaveCheckout) {
      const collected = opts.collectedKes ?? opts.amountPaid ?? amountKes;
      if (collected != null && collected !== "") {
        row.unreadable = false;
        row.charge = {
          amount_paid: String(collected),
          amount: amountKes != null ? String(amountKes) : String(collected),
          currency: opts.currency || "KES",
          status: opts.status || "SUCCEEDED",
        };
      }
    }
    const type = opts.type || "collection.succeeded";
    const data = {
      // ch_<checkout id> is the Bachs placeholder. Tests that want it pass it.
      // A real default keeps an ordinary paid event from looking unidentified.
      charge_id: opts.chargeId || `ch_paid_${checkoutId}`,
      checkout_id: checkoutId,
      status: opts.status || (type === "collection.failed" ? "FAILED" : "SUCCEEDED"),
      amount: amountKes,
      currency: opts.currency || "KES",
    };
    if (opts.fee != null) data.processing_fee = opts.fee;
    if (opts.feeCurrency) data.processing_fee_currency = opts.feeCurrency;
    if (opts.settledAmount != null) {
      data.settlement_amount = opts.settledAmount;
      data.settlement_currency = opts.settledCurrency || "USD";
    }
    if (opts.extraData) Object.assign(data, opts.extraData);
    const payload = {
      id: opts.eventId || `evt_${checkoutId}_${type}`,
      type,
      data,
    };
    const rawBody = JSON.stringify(payload);
    const now = opts.now ?? Date.now();
    const signed = signBachsBody(opts.secret, rawBody, opts.timestamp ?? Math.floor(now / 1000));
    return { rawBody, headers: signed.headers, payload };
  }
}

class BachsPayProvider {
  /**
   * @param {{ apiKey: string, mode?: 'sandbox' | 'live', fetchImpl?: typeof fetch }} opts
   */
  constructor(opts) {
    const live = opts.mode === "live";
    if (!opts.apiKey) {
      const err = new Error(live ? "BACHS_API_KEY is required" : "BACHS_API_KEY is required for sandbox");
      err.code = "bachs_key";
      throw err;
    }
    if (!live && String(opts.apiKey).startsWith("sk_live_")) {
      const err = new Error("live Bachs keys are refused");
      err.code = "bachs_live_refused";
      throw err;
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = live ? LIVE_API : SANDBOX_API;
    this.fetchImpl = opts.fetchImpl || fetch;
  }

  async createCheckout(request) {
    const cents = toCents(request.amountKes);
    if (cents == null) {
      const err = new Error("amount is not valid");
      err.code = "amount";
      throw err;
    }
    const body = {
      pricing: { currency: "KES", amount: fromCents(cents) },
      payment_method_types: request.paymentMethodTypes || ["MOMO_KES"],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      reference: String(request.reference || "").slice(0, 128),
      metadata: request.metadata || {},
      expires_in_minutes: expiresInMinutes(request.expiresInMinutes),
    };
    const customer = customerBody(request.customer);
    if (customer) body.customer = customer;
    const res = await this.fetchImpl(`${this.baseUrl}/v1/checkout-sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": String(request.idempotencyKey || ""),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const json = await res.json().catch(() => ({}));
    const checkoutId = json.checkout_id || json.id;
    const checkoutUrl = json.checkout_url || json.url;
    if (!res.ok || !checkoutId || !checkoutUrl) {
      logBachsError(res, json);
      const err = new Error("bachs checkout failed");
      err.code = "bachs_checkout";
      throw err;
    }
    if (!String(checkoutUrl).startsWith("https://")) {
      const err = new Error("bachs checkout url refused");
      err.code = "bachs_checkout";
      throw err;
    }
    const minutes = expiresInMinutes(request.expiresInMinutes);
    const expiresAt = json.expires_at || new Date(Date.now() + minutes * 60 * 1000).toISOString();
    return {
      checkoutId: String(checkoutId),
      checkoutUrl: String(checkoutUrl),
      status: json.status || "open",
      expiresAt,
    };
  }

  async cancelCheckout(checkoutId) {
    const res = await this.fetchImpl(
      `${this.baseUrl}/v1/checkout-sessions/${encodeURIComponent(checkoutId)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(15000),
      }
    );
    if (res.ok || res.status === 404 || res.status === 409) return;
    const json = await res.json().catch(() => ({}));
    logBachsError(res, json);
    const err = new Error("bachs cancel failed");
    err.code = "bachs_cancel";
    throw err;
  }

  async getCheckout(checkoutId) {
    const res = await this.fetchImpl(`${this.baseUrl}/v1/checkout-sessions/${encodeURIComponent(checkoutId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 404) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      logBachsError(res, json);
      const err = new Error("bachs checkout read failed");
      err.code = "bachs_checkout";
      throw err;
    }
    return {
      checkoutId: String(json.checkout_id || checkoutId),
      status: String(json.status || ""),
      paymentStatus: String(json.payment_status || ""),
      charge: json.charge || null,
    };
  }
}

/**
 * Mock unless BACHS_MODE is sandbox or an explicitly allowed live mode.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
function payProviderFromEnv(env = process.env, opts = {}) {
  const mode = assertBachsAllowed(env);
  if (mode === "off") return new MockPayProvider();
  return new BachsPayProvider({
    apiKey: String(env.BACHS_API_KEY || ""),
    mode,
    fetchImpl: opts.fetchImpl,
  });
}

MockPayProvider.sessions = new Map();

module.exports = {
  SANDBOX_API,
  LIVE_API,
  PROD_REF,
  DEFAULT_EXPIRES_MINUTES,
  MAX_EXPIRES_MINUTES,
  expiresInMinutes,
  bachsMode,
  liveAllowed,
  assertBachsAllowed,
  assertLiveTenant,
  paymentsClosed,
  checkoutFailure,
  MockPayProvider,
  BachsPayProvider,
  payProviderFromEnv,
};
