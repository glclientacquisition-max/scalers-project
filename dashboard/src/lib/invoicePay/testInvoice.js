/**
 * Super Admin KSh 10 test invoice.
 * Uses the existing finalize and pay-link functions. Does not change the plan.
 * The raw token is returned once.
 */

const TEST_LINE = "KSh 10 live payment test";
const TEST_AMOUNT = 10;
const ARIS_DID = "254709221536";

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

/**
 * @param {unknown} body
 * @returns {string | null}
 */
function testInvoiceFailure(error) {
  const message = error instanceof Error ? error.message : "";
  if (/still on beta/.test(message)) return { status: 409, error: "This business is still on beta." };
  if (/Aris/.test(message)) return { status: 409, error: "That line cannot take a test invoice." };
  if (/not change the plan/.test(message)) return { status: 409, error: "The plan did not stay the same." };
  if (/already paid/.test(message)) return { status: 409, error: "This test invoice is already paid." };
  if (/already issued/.test(message)) return { status: 409, error: "A pay link is already issued." };
  if (/business not found/.test(message)) return { status: 400, error: "Choose the business." };
  if (/archived/.test(message)) return { status: 400, error: "Archived businesses have no pay link." };
  if (/more than one/.test(message)) return { status: 400, error: "More than one test invoice is open." };
  if (/not KSh 10|did not open/.test(message)) return { status: 400, error: "The test invoice did not open at KSh 10." };
  if (/Add who is doing this/.test(message)) return { status: 400, error: "Add who is doing this." };
  return { status: 400, error: "Could not open the test invoice." };
}

function testInvoicePostError(body) {
  if (!body || typeof body !== "object") return "Confirm the test invoice.";
  const posted = /** @type {{ confirm?: unknown, reason?: unknown, tenantId?: unknown, amount?: unknown }} */ (body);
  if (posted.confirm !== true) return "Confirm the test invoice.";
  if (Object.prototype.hasOwnProperty.call(posted, "amount")) return "The test invoice is KSh 10.";
  if (typeof posted.reason !== "string" || posted.reason.trim().length < 3 || posted.reason.trim().length > 500) {
    return "Add a reason.";
  }
  if (typeof posted.tenantId !== "string" || !/^[0-9a-f-]{36}$/i.test(posted.tenantId.trim())) {
    return "Choose the business.";
  }
  return null;
}

/**
 * @param {object} db
 * @param {{ tenantId: string, actor: string, reason: string }} input
 */
async function issueKsh10TestInvoice(db, input) {
  const tenantId = input.tenantId.trim();
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  if (!actor) throw new Error("Add who is doing this.");

  const tenant = await db.loadTenant(tenantId);
  if (!tenant) throw new Error("business not found");
  if (digits(tenant.sautikit_virtual_number) === ARIS_DID) throw new Error("refusing the Aris line");
  if (tenant.archived_at) throw new Error("archived businesses have no pay link");
  if (tenant.billing_status === "beta" || !tenant.billing_enforcement || tenant.billing_enforcement === "off") {
    throw new Error("This business is still on beta.");
  }

  const before = {
    version: tenant.package_version_id,
    minutes: tenant.minutes_included,
    price: tenant.monthly_price_kes,
  };
  const matches = await db.findTestInvoices(tenantId);
  if (matches.length > 1) throw new Error("more than one KSh 10 test invoice");

  let invoice = matches[0] || null;
  if (invoice && Number(invoice.total_kes) !== TEST_AMOUNT) {
    throw new Error("test invoice total is not KSh 10");
  }
  if (invoice && invoice.status === "paid") throw new Error("test invoice already paid");
  if (invoice && invoice.has_token) throw new Error("pay link already issued");

  if (!invoice) {
    const id = await db.insertDraft({
      tenant_id: tenantId,
      status: "draft",
      currency: "KES",
      subtotal_kes: TEST_AMOUNT,
      total_kes: TEST_AMOUNT,
      billing_source: null,
      tax_kes: null,
    });
    await db.insertLine({
      invoice_id: id,
      tenant_id: tenantId,
      description: TEST_LINE,
      quantity: 1,
      unit_amount_kes: TEST_AMOUNT,
      amount_kes: TEST_AMOUNT,
      sort_order: 1,
    });
    invoice = { id, status: "draft", total_kes: TEST_AMOUNT, invoice_number: null, has_token: false };
  }

  if (invoice.status === "draft") {
    const issued = await db.finalize(invoice.id);
    if (!issued || issued.status !== "open" || Number(issued.total_kes) !== TEST_AMOUNT || issued.tax_kes != null) {
      throw new Error("test invoice did not open at KSh 10");
    }
    invoice = { ...invoice, status: "open", invoice_number: issued.invoice_number, total_kes: issued.total_kes };
  }

  const after = await db.loadTenant(tenantId);
  if (
    after.package_version_id !== before.version
    || after.minutes_included !== before.minutes
    || after.monthly_price_kes !== before.price
  ) {
    throw new Error("a test invoice must not change the plan");
  }

  const minted = await db.mint(invoice.id);
  if (!minted || typeof minted.token !== "string" || !minted.token.startsWith("pay_")) {
    throw new Error("pay link was not issued");
  }
  await db.audit({
    actor,
    action: "ksh10_live_test_invoice",
    tenantId,
    detail: {
      reason,
      invoice_id: invoice.id,
      invoice_number: invoice.invoice_number,
      total_kes: TEST_AMOUNT,
    },
  });

  return {
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    pay_path: `/pay/${minted.token}`,
    expires_at: minted.expires_at || null,
  };
}

/**
 * Service-role client. Reads the plan. Never updates it.
 * @param {import("@supabase/supabase-js").SupabaseClient} admin
 */
function supabaseTestInvoiceDb(admin) {
  return {
    async loadTenant(tenantId) {
      const tenant = await admin
        .from("tenants")
        .select("id, billing_enforcement, archived_at, sautikit_virtual_number, minutes_included")
        .eq("id", tenantId)
        .maybeSingle();
      if (tenant.error) throw new Error("Could not load this business.");
      if (!tenant.data) return null;
      const sub = await admin
        .from("tenant_subscriptions")
        .select("billing_status, package_version_id")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (sub.error) throw new Error("Could not load this business.");
      let monthly = null;
      const versionId = sub.data?.package_version_id || null;
      if (versionId) {
        const version = await admin
          .from("billing_package_versions")
          .select("monthly_price_kes")
          .eq("id", versionId)
          .maybeSingle();
        if (version.error) throw new Error("Could not load this business.");
        monthly = version.data?.monthly_price_kes ?? null;
      }
      return {
        ...tenant.data,
        billing_status: sub.data?.billing_status ?? "beta",
        package_version_id: versionId,
        monthly_price_kes: monthly,
      };
    },
    async findTestInvoices(tenantId) {
      const lines = await admin
        .from("invoice_lines")
        .select("invoice_id")
        .eq("tenant_id", tenantId)
        .eq("description", TEST_LINE);
      if (lines.error) throw new Error("Could not load this invoice.");
      const ids = [...new Set((lines.data || []).map((row) => row.invoice_id).filter(Boolean))];
      if (ids.length === 0) return [];
      const invoices = await admin
        .from("invoices")
        .select("id, status, invoice_number, total_kes, billing_source, tax_kes")
        .in("id", ids)
        .in("status", ["draft", "open", "paid"])
        .is("billing_source", null);
      if (invoices.error) throw new Error("Could not load this invoice.");
      const rows = invoices.data || [];
      const tokens = rows.length
        ? await admin
          .from("invoice_pay_tokens")
          .select("invoice_id")
          .in("invoice_id", rows.map((row) => row.id))
          .is("revoked_at", null)
        : { data: [], error: null };
      if (tokens.error) throw new Error("Could not load this invoice.");
      const openTokens = new Set((tokens.data || []).map((row) => row.invoice_id));
      return rows.map((row) => ({ ...row, has_token: openTokens.has(row.id) }));
    },
    async insertDraft(row) {
      const inserted = await admin.from("invoices").insert(row).select("id").single();
      if (inserted.error || !inserted.data?.id) throw new Error("Could not open the test invoice.");
      return inserted.data.id;
    },
    async insertLine(row) {
      const inserted = await admin.from("invoice_lines").insert(row);
      if (inserted.error) throw new Error("Could not open the test invoice.");
    },
    async finalize(invoiceId) {
      const issued = await admin.rpc("finalize_invoice", { p_invoice_id: invoiceId });
      if (issued.error) throw new Error(issued.error.message || "Could not open the test invoice.");
      return issued.data;
    },
    async mint(invoiceId) {
      const minted = await admin.rpc("mint_invoice_pay_token", { p_invoice_id: invoiceId, p_rotate: false });
      if (minted.error) throw new Error(minted.error.message || "pay link was not issued");
      const row = Array.isArray(minted.data) ? minted.data[0] : minted.data;
      return row;
    },
    async audit({ actor, action, tenantId, detail }) {
      const wrote = await admin.rpc("_billing_audit", {
        p_actor: actor,
        p_action: action,
        p_tenant_id: tenantId,
        p_detail: detail,
      });
      if (wrote.error) throw new Error("Could not write the audit row.");
    },
  };
}

module.exports = {
  ARIS_DID,
  TEST_AMOUNT,
  TEST_LINE,
  issueKsh10TestInvoice,
  supabaseTestInvoiceDb,
  testInvoiceFailure,
  testInvoicePostError,
};
