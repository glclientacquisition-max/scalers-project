const crypto = require("node:crypto");
const { fromCents, nextPart, splitKes, toCents } = require("../dashboard/src/lib/invoicePay/money");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function stateFor(invoice, tenant, tokenRow, now) {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "void") return "void";
  if (tokenRow.revokedAt || new Date(tokenRow.expiresAt).getTime() <= now) return "expired";
  if ((tenant.billingEnforcement || "off") === "off" || tenant.billingStatus === "beta") return "unavailable";
  if (invoice.status === "open") return "payable";
  return "closed";
}

function newReturnId() {
  return `ret_${crypto.randomBytes(32).toString("base64url")}`;
}

function attemptResult(row, extra) {
  return {
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    checkoutUrl: row.checkoutUrl,
    amountKes: row.amountKes,
    partIndex: row.partIndex,
    partCount: row.partCount,
    returnId: row.returnId,
    reused: false,
    inFlight: false,
    cancel: false,
    ...extra,
  };
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
  const credits = [];
  const alerts = [];
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
      ownerName: tenant.businessName || null,
      ownerEmail: tenant.alertEmail || null,
      ownerPhone: tenant.phone && !String(tenant.phone).startsWith("pending:") ? tenant.phone : null,
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
      if ((tenant.billingEnforcement || "off") === "off" || tenant.billingStatus === "beta") {
        throw new Error("beta tenants have no pay link");
      }
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
      const pending = attempts.find(
        (a) =>
          a.invoiceId === lookup.invoiceId &&
          (a.status === "pending" || a.status === "pending_unattached") &&
          a.partIndex === next.index
      );
      if (pending) {
        if (pending.status === "pending_unattached") {
          return attemptResult(pending, { unattached: true });
        }
        const expired = pending.expiresAt && new Date(pending.expiresAt).getTime() <= now;
        if (expired) {
          return attemptResult(pending, { cancel: true });
        }
        return attemptResult(pending, {
          reused: true,
          inFlight: !pending.checkoutUrl || !pending.checkoutSessionId,
        });
      }
      const held = attempts.findLast(
        (a) =>
          a.invoiceId === lookup.invoiceId &&
          a.status === "succeeded" &&
          a.partIndex === next.index &&
          a.checkoutSessionId &&
          (!a.expiresAt || new Date(a.expiresAt).getTime() > now)
      );
      if (held) return attemptResult(held, { held: true });
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
        expiresAt: null,
        returnId: newReturnId(),
        returnExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        providerAmount: null,
        providerCurrency: null,
        feeAmount: null,
        feeCurrency: null,
        createdAt: new Date(now).toISOString(),
        raw: {},
      };
      attempts.push(row);
      return attemptResult(row);
    },
    async attachCheckout(attemptId, created) {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row || row.status !== "pending") throw new Error("pay attempt is not pending");
      row.checkoutSessionId = created.checkoutId;
      row.checkoutUrl = created.checkoutUrl;
      row.expiresAt = created.expiresAt || null;
    },
    async parkUnattached(attemptId, created) {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row || (row.status !== "pending" && row.status !== "pending_unattached")) {
        throw new Error("pay attempt is not pending");
      }
      if (row.checkoutSessionId && row.checkoutSessionId !== created.checkoutId) {
        throw new Error("checkout session is already parked");
      }
      row.status = "pending_unattached";
      row.checkoutSessionId = created.checkoutId;
      row.checkoutUrl = created.checkoutUrl || null;
      row.expiresAt = created.expiresAt || null;
    },
    async releaseHeld(attemptId) {
      const row = attempts.find((a) => a.id === attemptId);
      if (!row || row.status !== "succeeded" || !row.checkoutSessionId) {
        throw new Error("pay attempt is not a held checkout");
      }
      row.expiresAt = new Date(now - 1000).toISOString();
    },
    async findAttemptByCheckout(checkoutId) {
      const row = [...attempts].reverse().find((a) => a.checkoutSessionId === checkoutId);
      if (!row) return null;
      const invoice = invoices.get(row.invoiceId);
      const next = invoice ? nextPart(splitKes(invoice.totalKes), invoice.amountPaidKes) : null;
      const newer = attempts.some(
        (other) =>
          other.invoiceId === row.invoiceId &&
          other.partIndex === row.partIndex &&
          other.id !== row.id &&
          (other.status === "pending" || other.status === "pending_unattached" || other.status === "succeeded") &&
          new Date(other.createdAt).getTime() >= new Date(row.createdAt).getTime()
      );
      const livePart = Boolean(
        invoice &&
          invoice.status === "open" &&
          next &&
          next.index === row.partIndex &&
          toCents(next.amountKes) === toCents(row.amountKes) &&
          !newer &&
          (row.status === "pending" || row.status === "pending_unattached" || row.status === "failed")
      );
      return {
        id: row.id,
        invoiceId: row.invoiceId,
        tenantId: row.tenantId,
        status: row.status,
        amountKes: row.amountKes,
        currency: row.currency,
        partIndex: row.partIndex,
        partCount: row.partCount,
        checkoutSessionId: row.checkoutSessionId,
        livePart,
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
      const row = payments.find(
        (p) => p.provider === provider && p.providerRef === providerRef && p.matchStatus !== "issue"
      );
      return row ? { id: row.id, amountKes: row.amountKes, matchStatus: row.matchStatus } : null;
    },
    async creditCancelled(input) {
      const key = `cancelled:${input.provider}:${input.providerRef}`;
      if (credits.some((row) => row.idempotencyKey === key)) return { duplicate: true };
      credits.push({
        id: id(),
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        amountKes: input.amountKes,
        reason: "cancelled_checkout",
        idempotencyKey: key,
        providerRef: input.providerRef,
      });
      alerts.push({ action: "cancelled_checkout_credit", providerRef: input.providerRef, amountKes: input.amountKes });
      return { duplicate: false };
    },
    async creditCheckoutExtra(input) {
      const amount = toCents(input.amountKes);
      if (amount == null || amount <= 0n) throw new Error("payment amount must be positive");
      const key = `checkout-extra:${input.provider}:${input.providerRef}`;
      if (credits.some((row) => row.idempotencyKey === key)) return { duplicate: true };
      credits.push({
        id: id(),
        tenantId: input.tenantId,
        invoiceId: input.invoiceId,
        amountKes: input.amountKes,
        reason: "checkout_extra",
        idempotencyKey: key,
        providerRef: input.providerRef,
      });
      alerts.push({ action: "checkout_extra_credit", providerRef: input.providerRef, amountKes: input.amountKes });
      return { duplicate: false };
    },
    async adjustOverpay(input) {
      const row = payments.find(
        (p) => p.provider === input.provider && p.providerRef === input.providerRef && p.matchStatus !== "issue"
      );
      if (!row) throw new Error("payment not found");
      const prev = toCents(row.amountKes);
      const next = toCents(input.amountKes);
      if (prev == null || next == null || next <= prev) return { updated: false };
      row.amountKes = String(input.amountKes);
      row.matchStatus = "over";
      return { updated: true };
    },
    async lookupReturn(returnId) {
      const row = attempts.find((a) => a.returnId === returnId);
      if (!row) return { found: false };
      if (!row.returnExpiresAt || new Date(row.returnExpiresAt).getTime() <= now) {
        return { found: true, state: "expired", invoiceId: row.invoiceId, tenantId: row.tenantId };
      }
      const invoice = invoices.get(row.invoiceId);
      const tenant = tenants.get(row.tenantId);
      let state = "closed";
      if (invoice.status === "paid") state = "paid";
      else if (invoice.status === "void") state = "void";
      else if ((tenant.billingEnforcement || "off") === "off" || tenant.billingStatus === "beta") state = "unavailable";
      else if (invoice.status === "open") state = "payable";
      return {
        found: true,
        state,
        businessName: tenant.businessName,
        invoiceNumber: invoice.invoiceNumber,
        invoiceId: invoice.id,
        tenantId: invoice.tenantId,
        totalKes: invoice.totalKes,
        amountPaidKes: invoice.amountPaidKes,
        dueAt: invoice.dueAt,
        checkoutSessionId: row.checkoutSessionId,
        attemptStatus: row.status,
      };
    },
    async applyPayment(input) {
      const existing = payments.find((p) => p.provider === input.provider && p.providerRef === input.providerRef);
      if (existing && existing.matchStatus !== "issue") return { id: existing.id, duplicate: true };
      if (existing && existing.matchStatus === "issue") {
        payments.splice(payments.indexOf(existing), 1);
      }
      const invoice = invoices.get(input.invoiceId);
      if (!invoice || invoice.status === "void" || invoice.status === "uncollectible") {
        throw new Error("invoice cannot be paid");
      }
      if (invoice.status === "draft") throw new Error("draft invoices are not payable");
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
        invoice.amountPaidKes = fromCents(total);
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
    credits,
    alerts,
  };
}

module.exports = { createMemoryLedger, hashToken };
