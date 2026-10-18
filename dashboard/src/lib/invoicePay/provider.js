/* eslint-disable @typescript-eslint/no-require-imports -- node:test loads this file with require() */
const crypto = require("node:crypto");
const { fromCents, toCents } = require("./money");
const { signBachsBody } = require("./signature");

const SANDBOX_API = "https://sandbox-api.bachs.io";
const PROD_REF = "fjxcdccgyhnvnnlnovcl";

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

/** Live mode and live keys are refused. No request is sent. */
function assertBachsAllowed(env = process.env) {
  const mode = bachsMode(env);
  if (mode === "live") {
    const err = new Error("BACHS_MODE=live is refused");
    err.code = "bachs_live_refused";
    throw err;
  }
  const key = String(env.BACHS_API_KEY || "");
  if (key.startsWith("sk_live_")) {
    const err = new Error("live Bachs keys are refused");
    err.code = "bachs_live_refused";
    throw err;
  }
  const url = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (url.includes(PROD_REF)) {
    const err = new Error("refusing production database");
    err.code = "prod_refused";
    throw err;
  }
  return mode;
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
    const row = {
      checkoutId,
      checkoutUrl: url.toString(),
      status: "open",
      request,
    };
    this.checkouts.set(checkoutId, row);
    return { checkoutId, checkoutUrl: row.checkoutUrl, status: "open" };
  }

  async getCheckout(checkoutId) {
    const row = this.checkouts.get(checkoutId);
    if (!row) return null;
    return { checkoutId: row.checkoutId, status: row.status, checkoutUrl: row.checkoutUrl };
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
    const row = this.checkouts.get(checkoutId);
    const amountKes = opts.amountKes || row?.request?.amountKes;
    const type = opts.type || "collection.succeeded";
    const data = {
      charge_id: opts.chargeId || `ch_${checkoutId}`,
      checkout_id: checkoutId,
      status: opts.status || (type === "collection.failed" ? "FAILED" : "SUCCEEDED"),
      amount: amountKes,
      currency: opts.currency || "KES",
    };
    if (opts.fee != null) data.fee = opts.fee;
    if (opts.feeCurrency) data.fee_currency = opts.feeCurrency;
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
   * @param {{ apiKey: string, fetchImpl?: typeof fetch }} opts
   */
  constructor(opts) {
    if (!opts.apiKey) {
      const err = new Error("BACHS_API_KEY is required for sandbox");
      err.code = "bachs_key";
      throw err;
    }
    if (String(opts.apiKey).startsWith("sk_live_")) {
      const err = new Error("live Bachs keys are refused");
      err.code = "bachs_live_refused";
      throw err;
    }
    this.apiKey = opts.apiKey;
    this.baseUrl = SANDBOX_API;
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
    };
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
      const err = new Error("bachs checkout failed");
      err.code = "bachs_checkout";
      throw err;
    }
    if (!String(checkoutUrl).startsWith("https://")) {
      const err = new Error("bachs checkout url refused");
      err.code = "bachs_checkout";
      throw err;
    }
    return { checkoutId: String(checkoutId), checkoutUrl: String(checkoutUrl), status: json.status || "open" };
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
      const err = new Error("bachs checkout read failed");
      err.code = "bachs_checkout";
      throw err;
    }
    return {
      checkoutId: String(json.checkout_id || checkoutId),
      status: String(json.status || ""),
      checkoutUrl: json.checkout_url || null,
    };
  }
}

/**
 * Mock unless BACHS_MODE=sandbox and a non-live key is set.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ fetchImpl?: typeof fetch }} [opts]
 */
function payProviderFromEnv(env = process.env, opts = {}) {
  const mode = assertBachsAllowed(env);
  if (mode === "off") return new MockPayProvider();
  return new BachsPayProvider({ apiKey: String(env.BACHS_API_KEY || ""), fetchImpl: opts.fetchImpl });
}

module.exports = {
  SANDBOX_API,
  PROD_REF,
  bachsMode,
  assertBachsAllowed,
  MockPayProvider,
  BachsPayProvider,
  payProviderFromEnv,
};
