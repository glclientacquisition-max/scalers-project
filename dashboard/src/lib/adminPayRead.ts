import { eatStamp } from "@/lib/adminActivityModel";
import { isMissingTableError, logAdminError } from "@/lib/adminErrors";
import {
  allowlistCount,
  attemptTitle,
  auditPreview,
  auditTitle,
  bachsModeLabel,
  bachsStatusFromEnv,
  hostingSwitches,
  dueLabel,
  invoiceHref,
  invoiceNumberLabel,
  invoiceStatusLabel,
  invoiceTone,
  kshLabel,
  matchStatusLabel,
  methodLabel,
  reconcileCounts,
  reviewPreview,
  reviewReasonFromRaw,
  reviewTitle,
  shopMoneyHref,
  type AdminInvoiceDetail,
  type AdminInvoiceEvent,
  type AdminInvoiceListRow,
  type AttentionItem,
  type BachsStatusView,
  type DbFlagSwitches,
  type ReviewTarget,
} from "@/lib/adminPayCopy";
import { getSupabaseAdmin } from "@/lib/supabase";

const INVOICE_LIST_LIMIT = 200;

function schemaMiss(error: unknown): boolean {
  if (isMissingTableError(error)) return true;
  if (!error || typeof error !== "object") return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  if (code === "42703" || code === "PGRST204") return true;
  return /column .+ does not exist|schema cache|function .+ does not exist|could not find the function/i.test(message);
}

async function businessNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("tenants").select("id, business_name").in("id", unique);
  if (error) throw error;
  return new Map((data || []).map((row) => [String(row.id), String(row.business_name || "Business")]));
}

function text(raw: unknown, key: string): string {
  if (!raw || typeof raw !== "object") return "";
  const value = (raw as Record<string, unknown>)[key];
  return value == null ? "" : String(value).trim();
}

function checkoutIdFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return "";
  const row = data as { checkout_id?: unknown; checkoutId?: unknown };
  return String(row.checkout_id || row.checkoutId || "").trim();
}

export async function loadAdminAttention(): Promise<{ items: AttentionItem[]; warning: string | null }> {
  const admin = getSupabaseAdmin();
  const items: AttentionItem[] = [];
  const businessByItem = new Map<string, string>();
  let warning: string | null = null;

  const reviews = await admin
    .from("payments")
    .select("provider, provider_ref, raw, tenant_id, invoice_id, created_at")
    .eq("match_status", "issue")
    .like("provider_ref", "checkout-total-review:%")
    .order("created_at", { ascending: false })
    .limit(100);
  if (reviews.error) {
    if (schemaMiss(reviews.error)) warning = "Some payment rows could not be loaded.";
    else {
      logAdminError("billing-attention", reviews.error);
      warning = "Some payment rows could not be loaded.";
    }
  } else {
    for (const row of reviews.data || []) {
      const raw = row.raw;
      const status = raw && typeof raw === "object" ? (raw as { review_status?: string }).review_status : null;
      if (status === "resolved") continue;
      const businessId = row.tenant_id ? String(row.tenant_id) : "";
      const reason = reviewReasonFromRaw(raw);
      const review: ReviewTarget = {
        businessId,
        providerRef: String(row.provider_ref),
        getKes: text(raw, "get_kes") || "0",
        seenKes: text(raw, "seen_kes") || "0",
        reason,
        invoiceId: row.invoice_id ? String(row.invoice_id) : null,
      };
      items.push({
        id: `review:${review.providerRef}`,
        kind: "checkout_review",
        title: reviewTitle(reason),
        preview: reviewPreview(review),
        when: eatStamp(String(row.created_at || "")),
        href: businessId ? shopMoneyHref(businessId) : "/admin/billing",
        review,
      });
    }
  }

  const loose = await admin
    .from("payments")
    .select("id, tenant_id, invoice_id, amount_kes, match_status, created_at, provider_ref")
    .in("match_status", ["unmatched", "partial"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (loose.error) {
    logAdminError("billing-attention-payments", loose.error);
    warning = "Some payment rows could not be loaded.";
  } else {
    for (const row of loose.data || []) {
      if (String(row.provider_ref || "").startsWith("checkout-total-review:")) continue;
      const businessId = row.tenant_id ? String(row.tenant_id) : "";
      const invoiceId = row.invoice_id ? String(row.invoice_id) : "";
      const kind = row.match_status === "partial" ? "partial" : "unmatched";
      const id = `pay:${row.id}`;
      if (businessId) businessByItem.set(id, businessId);
      items.push({
        id,
        kind,
        title: kind === "partial" ? "Partial payment" : "Unmatched payment",
        preview: kshLabel(row.amount_kes),
        when: eatStamp(String(row.created_at || "")),
        href: invoiceId ? invoiceHref(invoiceId) : businessId ? shopMoneyHref(businessId) : "/admin/billing/payments",
        review: null,
      });
    }
  }

  const retries = await admin
    .from("payment_events")
    .select("id, received_at, payload")
    .eq("needs_retry", true)
    .order("received_at", { ascending: false })
    .limit(100);
  const retryCheckouts: string[] = [];
  const retryRows: { id: string; received_at: string; checkoutId: string }[] = [];
  if (retries.error) {
    if (!schemaMiss(retries.error)) logAdminError("billing-attention-retry", retries.error);
    if (!schemaMiss(retries.error)) warning = "Some payment rows could not be loaded.";
  } else {
    for (const row of retries.data || []) {
      const checkoutId = checkoutIdFromPayload(row.payload);
      if (checkoutId) retryCheckouts.push(checkoutId);
      retryRows.push({ id: String(row.id), received_at: String(row.received_at || ""), checkoutId });
    }
  }

  const held = await admin
    .from("payment_attempts")
    .select("id, tenant_id, invoice_id, amount_kes, status, created_at, checkout_closed_at, checkout_session_id")
    .eq("status", "succeeded")
    .is("checkout_closed_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (held.error) {
    if (!schemaMiss(held.error)) {
      logAdminError("billing-attention-held", held.error);
      warning = "Some payment rows could not be loaded.";
    }
  } else {
    for (const row of held.data || []) {
      const businessId = row.tenant_id ? String(row.tenant_id) : "";
      const invoiceId = row.invoice_id ? String(row.invoice_id) : "";
      const id = `held:${row.id}`;
      if (businessId) businessByItem.set(id, businessId);
      items.push({
        id,
        kind: "held",
        title: "Checkout held",
        preview: kshLabel(row.amount_kes),
        when: eatStamp(String(row.created_at || "")),
        href: invoiceId ? invoiceHref(invoiceId) : businessId ? shopMoneyHref(businessId) : "/admin/billing/payments",
        review: null,
      });
    }
  }

  const attemptByCheckout = new Map<string, { invoice_id: string | null; tenant_id: string | null }>();
  if (retryCheckouts.length > 0) {
    const attempts = await admin
      .from("payment_attempts")
      .select("checkout_session_id, invoice_id, tenant_id")
      .in("checkout_session_id", [...new Set(retryCheckouts)]);
    if (!attempts.error) {
      for (const row of attempts.data || []) {
        if (row.checkout_session_id) attemptByCheckout.set(String(row.checkout_session_id), row);
      }
    }
  }
  for (const row of retryRows) {
    const attempt = row.checkoutId ? attemptByCheckout.get(row.checkoutId) : null;
    const invoiceId = attempt?.invoice_id ? String(attempt.invoice_id) : "";
    const businessId = attempt?.tenant_id ? String(attempt.tenant_id) : "";
    const id = `retry:${row.id}`;
    if (businessId) businessByItem.set(id, businessId);
    items.push({
      id,
      kind: "retry",
      title: "Payment read failed",
      preview: "Waiting to read this checkout again",
      when: eatStamp(row.received_at),
      href: invoiceId ? invoiceHref(invoiceId) : businessId ? shopMoneyHref(businessId) : "/admin/billing/payments",
      review: null,
    });
  }

  const nameIds = [
    ...items.flatMap((item) => (item.review?.businessId ? [item.review.businessId] : [])),
    ...businessByItem.values(),
  ];
  const names = await businessNames(nameIds).catch(() => new Map<string, string>());
  for (const item of items) {
    if (item.review?.businessId) {
      const name = names.get(item.review.businessId);
      if (name) {
        item.review.businessName = name;
        item.preview = reviewPreview(item.review, name);
      }
      continue;
    }
    const businessId = businessByItem.get(item.id);
    const name = businessId ? names.get(businessId) : null;
    if (name) item.preview = `${name} · ${item.preview}`;
  }

  const rank: Record<AttentionItem["kind"], number> = {
    checkout_review: 0,
    unmatched: 1,
    partial: 2,
    held: 3,
    retry: 4,
  };
  items.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return { items, warning };
}

export async function loadAdminInvoices(businessId?: string | null): Promise<{
  rows: AdminInvoiceListRow[];
  truncated: boolean;
  businessName: string | null;
}> {
  const admin = getSupabaseAdmin();
  let query = admin
    .from("invoices")
    .select("id, invoice_number, status, total_kes, amount_paid_kes, due_at, created_at, tenant_id")
    .order("created_at", { ascending: false })
    .limit(INVOICE_LIST_LIMIT + 1);
  if (businessId) query = query.eq("tenant_id", businessId);
  const { data, error } = await query;
  if (error) throw error;
  const sliced = (data || []).slice(0, INVOICE_LIST_LIMIT);
  const names = await businessNames(sliced.map((row) => String(row.tenant_id)));
  let businessName: string | null = null;
  if (businessId) {
    businessName = names.get(businessId) || null;
    if (!businessName) {
      const one = await businessNames([businessId]);
      businessName = one.get(businessId) || null;
    }
  }
  const rows: AdminInvoiceListRow[] = sliced.map((row) => {
    const status = String(row.status || "");
    const id = String(row.id);
    const tenantId = String(row.tenant_id);
    return {
      id,
      number: invoiceNumberLabel(row.invoice_number),
      businessId: tenantId,
      businessName: names.get(tenantId) || "Business",
      status,
      statusLabel: invoiceStatusLabel(status),
      tone: invoiceTone(status, row.due_at ? String(row.due_at) : null),
      total: kshLabel(row.total_kes),
      paid: kshLabel(row.amount_paid_kes),
      due: dueLabel(row.due_at ? String(row.due_at) : null),
      created: eatStamp(String(row.created_at || "")),
    };
  });
  return { rows, truncated: (data || []).length > INVOICE_LIST_LIMIT, businessName };
}

function mentionsInvoice(detail: unknown, invoiceId: string, checkoutIds: Set<string>): boolean {
  const text = JSON.stringify(detail || {});
  if (text.includes(invoiceId)) return true;
  for (const id of checkoutIds) {
    if (id && text.includes(id)) return true;
  }
  return false;
}

export async function loadAdminInvoice(id: string): Promise<AdminInvoiceDetail | null> {
  const admin = getSupabaseAdmin();
  const { data: invoice, error } = await admin
    .from("invoices")
    .select("id, invoice_number, status, total_kes, amount_paid_kes, due_at, created_at, tenant_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!invoice) return null;

  const tenantId = String(invoice.tenant_id);
  const names = await businessNames([tenantId]);
  let warning: string | null = null;

  const linesQuery = await admin
    .from("invoice_lines")
    .select("id, description, quantity, amount_kes, sort_order")
    .eq("invoice_id", id)
    .order("sort_order", { ascending: true });
  if (linesQuery.error && !schemaMiss(linesQuery.error)) {
    logAdminError("billing-invoice-lines", linesQuery.error);
    warning = "Some invoice rows could not be loaded.";
  }

  const paymentsQuery = await admin
    .from("payments")
    .select("id, amount_kes, match_status, paid_at, provider_ref")
    .eq("invoice_id", id)
    .order("paid_at", { ascending: false });
  if (paymentsQuery.error && !schemaMiss(paymentsQuery.error)) {
    logAdminError("billing-invoice-payments", paymentsQuery.error);
    warning = "Some invoice rows could not be loaded.";
  }

  const attemptsQuery = await admin
    .from("payment_attempts")
    .select("id, status, amount_kes, part_index, part_count, created_at, checkout_closed_at, checkout_session_id")
    .eq("invoice_id", id)
    .order("created_at", { ascending: false });
  if (attemptsQuery.error && !schemaMiss(attemptsQuery.error)) {
    logAdminError("billing-invoice-attempts", attemptsQuery.error);
    warning = "Some invoice rows could not be loaded.";
  }

  const receiptsQuery = await admin
    .from("invoice_receipts")
    .select("id, receipt_number, amount_kes, method, paid_at")
    .eq("invoice_id", id)
    .order("paid_at", { ascending: false });
  if (receiptsQuery.error && !schemaMiss(receiptsQuery.error)) {
    logAdminError("billing-invoice-receipts", receiptsQuery.error);
    warning = "Some invoice rows could not be loaded.";
  }

  const checkoutIds = new Set<string>();
  for (const row of attemptsQuery.data || []) {
    if (row.checkout_session_id) checkoutIds.add(String(row.checkout_session_id));
  }

  const auditQuery = await admin
    .from("billing_audit_log")
    .select("id, created_at, actor, action, detail")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(80);
  if (auditQuery.error && !schemaMiss(auditQuery.error)) {
    logAdminError("billing-invoice-audit", auditQuery.error);
    warning = "Some invoice rows could not be loaded.";
  }

  const status = String(invoice.status || "");
  const lines = (linesQuery.data || []).map((row) => ({
    id: String(row.id),
    title: String(row.description || "Line"),
    preview: `${kshLabel(row.amount_kes)} · qty ${row.quantity ?? 1}`,
  }));
  const payments: AdminInvoiceEvent[] = (paymentsQuery.data || []).map((row) => ({
    id: String(row.id),
    title: matchStatusLabel(String(row.match_status || "")),
    preview: kshLabel(row.amount_kes),
    when: eatStamp(String(row.paid_at || "")),
  }));
  const attempts: AdminInvoiceEvent[] = (attemptsQuery.data || []).map((row) => {
    const held = String(row.status || "") === "succeeded" && !row.checkout_closed_at;
    const part = row.part_count ? `Part ${Number(row.part_index || 0) + 1} of ${row.part_count}` : "";
    return {
      id: String(row.id),
      title: attemptTitle(String(row.status || ""), held),
      preview: [part, kshLabel(row.amount_kes)].filter(Boolean).join(" · "),
      when: eatStamp(String(row.created_at || "")),
    };
  });
  const receipts: AdminInvoiceEvent[] = (receiptsQuery.data || []).map((row) => ({
    id: String(row.id),
    title: String(row.receipt_number || "Receipt"),
    preview: `${kshLabel(row.amount_kes)} · ${methodLabel(row.method)}`,
    when: eatStamp(String(row.paid_at || "")),
  }));
  const audit: AdminInvoiceEvent[] = (auditQuery.data || [])
    .filter((row) => mentionsInvoice(row.detail, id, checkoutIds))
    .map((row) => ({
      id: String(row.id),
      title: auditTitle(String(row.action || "")),
      preview: auditPreview(row.actor ? String(row.actor) : null, (row.detail as Record<string, unknown>) || null),
      when: eatStamp(String(row.created_at || "")),
    }));

  return {
    id: String(invoice.id),
    number: invoiceNumberLabel(invoice.invoice_number),
    businessId: tenantId,
    businessName: names.get(tenantId) || "Business",
    statusLabel: invoiceStatusLabel(status),
    tone: invoiceTone(status, invoice.due_at ? String(invoice.due_at) : null),
    total: kshLabel(invoice.total_kes),
    paid: kshLabel(invoice.amount_paid_kes),
    due: dueLabel(invoice.due_at ? String(invoice.due_at) : null),
    created: eatStamp(String(invoice.created_at || "")),
    lines,
    payments,
    attempts,
    receipts,
    audit,
    warning,
  };
}

export async function countTenantInvoices(tenantId: string): Promise<number | null> {
  const admin = getSupabaseAdmin();
  const { count, error } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (error) {
    if (!schemaMiss(error)) logAdminError("billing-invoice-count", error);
    return null;
  }
  return count ?? 0;
}

export async function loadBachsStatus(): Promise<BachsStatusView> {
  const flags = bachsStatusFromEnv({
    mode: process.env.BACHS_MODE,
    liveAllowed: process.env.BACHS_LIVE_ALLOWED,
    key: process.env.BACHS_API_KEY,
    webhookSecret: process.env.BACHS_WEBHOOK_SECRET,
  });
  const envList = allowlistCount(process.env.BACHS_LIVE_TENANT_ALLOWLIST);
  const admin = getSupabaseAdmin();

  let liveSummary = envList.all ? "All businesses" : envList.count === 0 ? "None" : String(envList.count);
  let liveNames: string[] = [];
  const table = await admin.from("billing_live_tenants").select("tenant_id, enabled").eq("enabled", true);
  if (!table.error) {
    const ids = (table.data || []).map((row) => String(row.tenant_id));
    const names = ids.length ? await businessNames(ids).catch(() => new Map<string, string>()) : new Map<string, string>();
    liveNames = ids.map((id) => names.get(id) || "Business");
    const envNote = envList.all ? "Environment list: all" : `Environment list: ${envList.count}`;
    liveSummary = liveNames.length === 0 ? `None on the list. ${envNote}.` : `${liveNames.length} on the list. ${envNote}.`;
  } else if (!schemaMiss(table.error)) {
    logAdminError("billing-live-tenants", table.error);
  }

  let lastWebhook = "None yet";
  let webhooks24h = "0";
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const latest = await admin.from("payment_events").select("received_at").order("received_at", { ascending: false }).limit(1);
  const recent = await admin
    .from("payment_events")
    .select("id", { count: "exact", head: true })
    .gte("received_at", since);
  if (latest.error || recent.error) {
    const err = latest.error || recent.error;
    if (err && !schemaMiss(err)) logAdminError("billing-webhooks", err);
    if (err && schemaMiss(err)) {
      lastWebhook = "Not on this database";
      webhooks24h = "Not on this database";
    }
  } else {
    const at = latest.data?.[0]?.received_at ? eatStamp(String(latest.data[0].received_at)) : "";
    lastWebhook = at || "None yet";
    webhooks24h = String(recent.count ?? 0);
  }

  let reconcileAvailable = false;
  let reconcile: { label: string; count: number }[] = [];
  const report = await admin.rpc("billing_payment_reconciliation");
  if (report.error) {
    if (!schemaMiss(report.error)) logAdminError("billing-reconcile", report.error);
  } else {
    reconcileAvailable = true;
    const rows = Array.isArray(report.data) ? report.data : [];
    reconcile = reconcileCounts(rows as { kind?: string | null }[]);
  }

  const hosting = hostingSwitches({
    mode: process.env.BACHS_MODE,
    liveAllowed: process.env.BACHS_LIVE_ALLOWED,
    noticesSend: process.env.BILLING_NOTICES_SEND,
    planChange: process.env.DESK_PLAN_CHANGE,
  });
  const settings = await admin
    .from("billing_lifecycle_settings")
    .select("package_editor_enabled, new_signup_trial_enabled")
    .eq("id", 1)
    .maybeSingle();
  let dbFlags: DbFlagSwitches = { available: false, packageEditorEnabled: false, signupTrialEnabled: false };
  if (settings.error) {
    if (!schemaMiss(settings.error)) logAdminError("billing-flags", settings.error);
  } else if (settings.data) {
    dbFlags = {
      available: true,
      packageEditorEnabled: settings.data.package_editor_enabled !== false,
      signupTrialEnabled: settings.data.new_signup_trial_enabled === true,
    };
  }

  return {
    modeLabel: bachsModeLabel(flags.mode),
    liveSwitch: flags.liveSwitch,
    keySet: flags.keySet,
    webhookSecretSet: flags.webhookSecretSet,
    hosting,
    dbFlags,
    liveSummary,
    liveNames,
    lastWebhook,
    webhooks24h,
    reconcileAvailable,
    reconcile,
  };
}
