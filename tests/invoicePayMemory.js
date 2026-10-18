const crypto = require("node:crypto");
const { fromCents, nextPart, splitKes, toCents } = require("../dashboard/src/lib/invoicePay/money");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function stateFor(invoice, tenant, tokenRow, now) {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void") return "void";
  if (tokenRow.revokedAt || new Date(tokenRow.expiresAt).getTime() <= now) return "expired";
  if ((tenant.billingEnforcement || "off") === "off") return "unavailable";
  if (invoice.status === "open") return "payable";
  return "closed";
}

/**
 * In-memory stand-in for the pay RPCs. Same rules the SQL uses for tests.
 * @param {{ now?: number }} [opts]
 */
function createMemoryLedger(opts = {}) {
  let now = opts.now ?? Date.now();
  const tenants = new Map();
  const invoices = new Map();
  const tokens = [];
  const attempts = [];
  const events = new Map();
  const payments = [];
  let seq = 0;
  const id = () => `id-${++seq}`;

  function lookupToken(token) {
    const row = tokens.find((t) => t.tokenHash === hashToken(token));
    if (!row) return { found: false };
    const invoice = invoices.get(row.invoiceId);
    const tenant = tenants.get(invoice.tenantId);
    return {
      found: true,
      state: stateFor(invoice, tenant, row, now),
      businessName: tenant.businessName,
      invoiceNumber: invoice.invoiceNumber,
      invoiceId: invoice.id,
      tenantId: invoice.tenantId,
      subtotalKes: invoice.subtotalKes,
      totalKes: invoice.totalKes,
      amountPaidKes: invoice.amountPaidKes,
      dueAt: invoice.dueAt,
      enforcement: tenant.billingEnforcement,
    };
  }

  return {
    setNow(value) {
      now = value;
    },
    tenants,
    invoices,
    attempts,
    payments,
    events,
    seedTenant(tenant) {
      tenants.set(tenant.id, {
        billingEnforcement: "off",
        archivedAt: null,
        ...tenant,
      });
    },
    seedInvoice(invoice) {
      invoices.set(invoice.id, {
        status: "open",
        amountPaidKes: "0",
        subtotalKes: invoice.totalKes,
        dueAt: null,
        invoiceNumber: "SC-2026-000001",
        ...invoice,
      });
    },
    mint(invoiceId, rotate = false) {
      const invoice = invoices.get(invoiceId);
      const tenant = tenants.get(invoice.tenantId);
      if (!invoice || invoice.status !== "open") throw new Error("only an open invoice can have a pay link");
      if (toCents(invoice.amountPaidKes) >= toCents(invoice.totalKes)) throw new Error("invoice has nothing left to pay");
      if (tenant.archivedAt) throw new Error("archived businesses have no pay link");
      if ((tenant.billingEnforcement || "off") === "off") throw new Error("beta tenants have no pay link");
      const active = tokens.find((t) => t.invoiceId === invoiceId && !t.revokedAt);
      if (active && !rotate) throw new Error("pay link already exists");
      if (rotate) {
        for (const token of tokens) {
          if (token.invoiceId === invoiceId && !token.revokedAt) token.revokedAt = new Date(now).toISOString();
        }
      }
      const token = `pay_${crypto.randomBytes(32).toString("base64url")}`;
      tokens.push({
        tokenHash: hashToken(token),
        invoiceId,
        expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
        revokedAt: null,
      });
      return token;
    },
    async lookup(token) {
      return lookupToken(token);
    },
    async createAttempt(input) {
      const lookup = lookupToken(input.token);
      if (!lookup.found || lookup.state !== "payable") throw new Error("invoice cannot be paid");
      const next = nextPart(splitKes(lookup.totalKes), lookup.amountPaidKes);
      if (!next) throw new Error("invoice has nothing left to pay");
      if (toCents(input.amountKes) !== toCents(next.amountKes)) throw new Error("pay amount does not match the next part");
      const fresh = attempts.find(
        (a) =>
          a.invoiceId === lookup.invoiceId &&
          a.status === "pending" &&
          a.partIndex === next.index &&
          a.checkoutUrl &&
          now - new Date(a.createdAt).getTime() < 30 * 60 * 1000
      );
      if (fresh) {
        return {
          id: fresh.id,
          checkoutSessionId: fresh.checkoutSessionId,
          checkoutUrl: fresh.checkoutUrl,
          amountKes: fresh.amountKes,
          partIndex: fresh.partIndex,
          partCount: fresh.partCount,
          reused: true,
        };
      }
      const row = {
        id: id(),
        invoiceId: lookup.invoiceId,
        tenantId: lookup.tenantId,
        status: "pending",
        amountKes: next.amountKes,
        currency: "KES",
        partIndex: next.index,
        partCount: next.count,
        checkoutSessionId: null,
        checkoutUrl: null,
        providerAmount: null,
        providerCurrency: null,
        feeAmount: null,
        feeCurrency: null,
        createdAt: new Date(now).toISOString(),
        raw: {},
      };
      attempts.push(row);
      return {
        id: row.id,
        checkoutSessionId: null,
        checkoutUrl: null,
        amountKes: row.amountKes,
        partIndex: row.partIndex,
        partCount: row.partCount,
        reused: false,
      };
    },
    async attachCheckout(attemptId, created) {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row || row.status !== "pending") throw new Error("pay attempt is not pending");
      row.checkoutSessionId = created.checkoutId;
      row.checkoutUrl = created.checkoutUrl;
    },
    async findAttemptByCheckout(checkoutId) {
      const row = [...attempts].reverse().find((a) => a.checkoutSessionId === checkoutId);
      if (!row) return null;
      return {
        id: row.id,
        invoiceId: row.invoiceId,
        tenantId: row.tenantId,
        status: row.status,
        amountKes: row.amountKes,
        currency: row.currency,
        checkoutSessionId: row.checkoutSessionId,
      };
    },
    async markAttempt(attemptId, patch) {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row) throw new Error("missing attempt");
      Object.assign(row, patch);
    },
    async recordEvent(input) {
      const key = `${input.provider}:${input.eventKey}`;
      const existing = events.get(key);
      if (existing) {
        existing.attempts += 1;
        return { attempts: existing.attempts };
      }
      events.set(key, { attempts: 1, payload: input.payload });
      return { attempts: 1 };
    },
    async findPaymentByRef(provider, providerRef) {
      const row = payments.find((p) => p.provider === provider && p.providerRef === providerRef);
      return row ? { id: row.id } : null;
    },
    async applyPayment(input) {
      const existing = payments.find((p) => p.provider === input.provider && p.providerRef === input.providerRef);
      if (existing) return { id: existing.id, duplicate: true };
      const invoice = invoices.get(input.invoiceId);
      const paid = toCents(invoice.amountPaidKes) + toCents(input.amountKes);
      const total = toCents(invoice.totalKes);
      let match = "partial";
      if (paid === total) match = "matched";
      else if (paid > total) match = "over";
      const row = {
        id: id(),
        provider: input.provider,
        providerRef: input.providerRef,
        billRef: input.providerRef,
        invoiceId: input.invoiceId,
        amountKes: input.amountKes,
        matchStatus: match,
        settledAmountMinor: input.settledAmountMinor,
        settledCurrency: input.settledCurrency,
        feeMinor: input.feeMinor,
        raw: input.raw,
      };
      payments.push(row);
      if (match === "partial") invoice.amountPaidKes = fromCents(paid);
      else {
        invoice.amountPaidKes = invoice.totalKes;
        invoice.status = "paid";
      }
      return { id: row.id, duplicate: false, match };
    },
    async recordIssue(input) {
      const existing = payments.find((p) => p.provider === input.provider && p.providerRef === input.providerRef);
      if (existing) return { id: existing.id, duplicate: true };
      if (input.amountKes && toCents(input.amountKes) > 0n) {
        const row = {
          id: id(),
          provider: input.provider,
          providerRef: input.providerRef,
          billRef: input.providerRef,
          invoiceId: input.invoiceId,
          amountKes: input.amountKes,
          matchStatus: "issue",
          settledAmountMinor: input.settledAmountMinor,
          settledCurrency: input.settledCurrency,
          feeMinor: input.feeMinor,
          reason: input.reason,
          raw: input.raw,
        };
        payments.push(row);
        return { id: row.id, duplicate: false };
      }
      return { id: null, duplicate: false };
    },
  };
}

module.exports = { createMemoryLedger, hashToken };
