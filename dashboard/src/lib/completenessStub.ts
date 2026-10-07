import { jsonFieldSource } from "./catalogSeeds";
import { type FieldSource } from "./fieldSource";

export type ProvenanceMeta = Record<string, FieldSource>;

export type CaptureScore = {
  overall: number;
  domains: Record<string, number>;
  ready_badge: boolean;
  next_gaps: Array<{ domain?: string; action?: string }>;
};

export type CaptureHold = {
  allowed: boolean;
  reasons: string[];
};

export type ScoreTenant = {
  business_name?: string | null;
  vertical?: string | null;
  sautikit_virtual_number?: string | null;
  voice_languages?: string[] | null;
  agent_name?: string | null;
  product_catalog?: unknown;
  services_catalog?: unknown;
  hours_schedule?: unknown;
  business_hours?: string | null;
  business_locations?: unknown;
  business_policies?: unknown;
  faqs?: unknown;
  whatsapp_notification_number?: string | null;
  alert_email?: string | null;
  notify_channels?: { sms?: boolean; whatsapp?: boolean; email?: boolean } | null;
  agent_tone?: string | null;
  agent_tools?: unknown;
  daily_bulletin?: unknown;
};

function round(n: number): number {
  return Math.round(n);
}

function rows(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object") as Array<
    Record<string, unknown>
  >;
}

function policyRecord(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function textOf(raw: unknown): string {
  return String(raw || "").trim();
}

/**
 * §10.2 / §10.5: only source=owner counts. Import, seed, inferred,
 * call_suggested, and missing meta are 0 until the owner confirms.
 */
function fieldScore(
  hasValue: boolean,
  path: string,
  meta: ProvenanceMeta,
  jsonSource: FieldSource | null
): number {
  if (!hasValue) return 0;
  const source = meta[path] || jsonSource;
  return source === "owner" ? 1 : 0;
}

/** Calm copy when Platform still returns the pre-confirm gap strings. */
const GAP_REVIEW: Record<string, string> = {
  "Add products or services with owner-confirmed names and prices.":
    "Add your catalogue, then save.",
  "Confirm at least three FAQs with owner source (not seed).":
    "Review and confirm your answers.",
  "Set a WhatsApp or email alert and confirm notify routing.":
    "Review and confirm who we alert.",
  "Add how customers pay (M-Pesa till, paybill, or cash).":
    "Review and confirm how customers pay.",
};

export function reviewGapCopy(action: string): string {
  const text = String(action || "").trim();
  return GAP_REVIEW[text] || text;
}

function hasStructuredHours(schedule: unknown): boolean {
  if (!schedule || typeof schedule !== "object") return false;
  const days = (schedule as { days?: unknown }).days;
  if (!days || typeof days !== "object") return false;
  return Object.values(days as Record<string, unknown>).some((val) => {
    return Boolean(val && typeof val === "object" && "open" in (val as object));
  });
}

function hasLocations(tenant: ScoreTenant, policies: Record<string, unknown>): boolean {
  if (Array.isArray(tenant.business_locations) && tenant.business_locations.length > 0) {
    return true;
  }
  const coverage = policies.coverage_areas;
  if (Array.isArray(coverage) && coverage.length > 0) return true;
  return textOf(coverage).length > 0;
}

function productScore(
  catalog: unknown,
  isRetail: boolean,
  meta: ProvenanceMeta
): number {
  if (!isRetail) return 0;
  let named = 0;
  let scored = 0;
  const categories: string[] = [];
  rows(catalog).forEach((item, index) => {
    const name = textOf(item.name);
    if (!name) return;
    named += 1;
    const sku = textOf(item.sku) || String(index + 1);
    scored += fieldScore(
      true,
      `catalog.product.${sku}.name`,
      meta,
      jsonFieldSource(item)
    );
    const category = textOf(item.category).toLowerCase();
    if (category && !categories.includes(category)) categories.push(category);
  });
  if (!named) return 0;
  const avg = scored / named;
  if (named >= 10) return Math.min(100, avg * 100);
  if (categories.length >= 3) return Math.min(100, avg * 100 * 0.85);
  return Math.min(60, avg * 60);
}

function serviceOk(item: Record<string, unknown>): boolean {
  const pricing = textOf(item.price) !== "" || textOf(item.pricing_mode) !== "";
  const visitRaw = item.site_visit_required;
  const visitText = textOf(visitRaw).toLowerCase();
  const hasSite =
    Object.prototype.hasOwnProperty.call(item, "site_visit_required") ||
    visitText === "true" ||
    visitText === "false" ||
    visitText === "yes" ||
    visitText === "no";
  return pricing && hasSite;
}

function serviceScore(
  catalog: unknown,
  isHome: boolean,
  meta: ProvenanceMeta
): number {
  if (!isHome) return 0;
  let ok = 0;
  let scored = 0;
  rows(catalog).forEach((item, index) => {
    if (!textOf(item.name) || !serviceOk(item)) return;
    ok += 1;
    scored += fieldScore(
      true,
      `catalog.service.${index + 1}.name`,
      meta,
      jsonFieldSource(item)
    );
  });
  if (!ok) return 0;
  const avg = scored / ok;
  if (ok >= 3) return Math.min(100, avg * 100);
  return Math.min(50, avg * 50);
}

function confirmedFaqCount(faqs: unknown): number {
  return rows(faqs).filter((item) => {
    const status = textOf(item.status).toLowerCase();
    const source = textOf(item.source).toLowerCase();
    return (
      textOf(item.question) &&
      textOf(item.answer) &&
      (status === "confirmed" || status === "golden") &&
      source === "owner"
    );
  }).length;
}

export function hasVerifiedNotify(tenant: ScoreTenant, meta: ProvenanceMeta = {}): boolean {
  const channels = tenant.notify_channels || {};
  const whatsapp = textOf(tenant.whatsapp_notification_number);
  const email = textOf(tenant.alert_email);
  const whatsappOk = Boolean(whatsapp) && channels.whatsapp !== false;
  const emailOk = Boolean(email) && channels.email !== false;
  const smsOk = Boolean(whatsapp) && channels.sms !== false;
  if (meta["team.notify.whatsapp"] === "owner") return true;
  return whatsappOk || emailOk || smsOk;
}

function holdsAllowed(policies: Record<string, unknown>, meta: ProvenanceMeta): boolean {
  const nested =
    policies.holds && typeof policies.holds === "object"
      ? (policies.holds as Record<string, unknown>)
      : policies.other && typeof policies.other === "object"
        ? ((policies.other as Record<string, unknown>).holds as Record<string, unknown> | undefined)
        : undefined;
  const allowed = textOf(nested && nested.allowed ? nested.allowed : policies.holds_allowed).toLowerCase();
  if (allowed === "yes" || allowed === "true" || allowed === "1") return true;
  if (allowed === "no" || allowed === "false" || allowed === "0") return false;
  return meta["policies.holds.allowed"] === "owner";
}

/** Catalogue-level hold check. Missing holdable stays unset and does not block. */
function ownerConfirmedProduct(catalog: unknown, meta: ProvenanceMeta): boolean {
  return rows(catalog).some((item, index) => {
    if (!textOf(item.name)) return false;
    const sku = textOf(item.sku) || String(index + 1);
    const source = meta[`catalog.product.${sku}.name`] || jsonFieldSource(item);
    return source === "owner";
  });
}

function anyOwner(tenant: ScoreTenant, meta: ProvenanceMeta): boolean {
  if (Object.values(meta).some((source) => source === "owner")) return true;
  const bags = [...rows(tenant.product_catalog), ...rows(tenant.services_catalog), ...rows(tenant.faqs)];
  return bags.some((item) => jsonFieldSource(item) === "owner");
}

function seedIdentity(meta: ProvenanceMeta): boolean {
  return Object.entries(meta).some(
    ([path, source]) => source === "seed" && path.startsWith("identity.")
  );
}

function policyFieldScore(
  path: string,
  value: string,
  meta: ProvenanceMeta
): number {
  return fieldScore(Boolean(value), path, meta, null);
}

export function scoreCaptureTenant(
  tenant: ScoreTenant,
  meta: ProvenanceMeta = {}
): CaptureScore {
  const vertical = textOf(tenant.vertical).toLowerCase() || "general";
  const isRetail = vertical === "retail" || vertical === "shop";
  const isHome = vertical === "home_services" || vertical === "home";
  const policies = policyRecord(tenant.business_policies);
  const languages = Array.isArray(tenant.voice_languages) ? tenant.voice_languages.length : 0;

  const identity =
    ((fieldScore(Boolean(textOf(tenant.business_name)), "identity.business_name", meta, null) +
      fieldScore(Boolean(textOf(tenant.vertical)), "identity.vertical", meta, null) +
      fieldScore(
        Boolean(textOf(tenant.sautikit_virtual_number)),
        "identity.primary_phone",
        meta,
        null
      ) +
      fieldScore(
        languages > 0 || Boolean(textOf(tenant.agent_name)),
        "identity.language",
        meta,
        null
      )) /
      4) *
    100;

  let catalog = Math.max(
    productScore(tenant.product_catalog, isRetail, meta),
    serviceScore(tenant.services_catalog, isHome, meta)
  );
  if (!isRetail && !isHome) {
    catalog =
      Math.max(
        productScore(tenant.product_catalog, true, meta),
        serviceScore(tenant.services_catalog, true, meta)
      ) * 0.5;
  }

  const hours =
    fieldScore(
      hasStructuredHours(tenant.hours_schedule) || Boolean(textOf(tenant.business_hours)),
      "hours.weekly_grid",
      meta,
      null
    ) * 100;

  const locations =
    fieldScore(hasLocations(tenant, policies), "locations.branches", meta, null) * 100;

  const payment = textOf(policies.payment);
  const deposit = textOf(policies.deposit);
  const payments =
    ((policyFieldScore("policies.payment", payment || deposit, meta) +
      policyFieldScore("payments.methods", payment, meta)) /
      2) *
    100;

  const policiesScore =
    ((policyFieldScore("policies.returns", textOf(policies.returns), meta) +
      policyFieldScore("policies.delivery", textOf(policies.delivery), meta) +
      policyFieldScore(
        "policies.other",
        textOf(policies.other) || textOf(policies.warranty),
        meta
      )) /
      3) *
    100;

  const faqCount = confirmedFaqCount(tenant.faqs);
  const faqs = Math.min(100, (faqCount / 3) * 100);

  const teamOwner =
    meta["team.notify"] === "owner" || meta["team.notify.whatsapp"] === "owner";
  const team = teamOwner ? 100 : 0;

  const assistant =
    ((fieldScore(Boolean(textOf(tenant.agent_name)), "assistant.agent_name", meta, null) +
      fieldScore(
        Boolean(textOf(tenant.agent_tone)) || tenant.agent_tools != null,
        "assistant.language",
        meta,
        null
      ) +
      fieldScore(tenant.agent_tools != null, "assistant.tools", meta, null)) /
      3) *
    100;

  const bulletin =
    fieldScore(
      Array.isArray(tenant.daily_bulletin) && tenant.daily_bulletin.length > 0,
      "bulletin.items",
      meta,
      null
    ) * 100;

  const overall =
    (identity + catalog + hours + locations + payments + policiesScore + faqs + team + assistant + bulletin) /
    10;

  const namedCatalog =
    rows(tenant.product_catalog).some((item) => textOf(item.name)) ||
    rows(tenant.services_catalog).some((item) => textOf(item.name));
  const anyFaq = rows(tenant.faqs).some(
    (item) => textOf(item.question) && textOf(item.answer)
  );
  const hasAlert =
    Boolean(textOf(tenant.whatsapp_notification_number)) || Boolean(textOf(tenant.alert_email));

  const gaps: CaptureScore["next_gaps"] = [];
  if (catalog < 40) {
    gaps.push({
      domain: "catalog",
      action: namedCatalog
        ? "Add your catalogue, then save."
        : "Add products or services with prices.",
    });
  }
  if (faqCount < 3) {
    gaps.push({
      domain: "faqs",
      action: anyFaq ? "Review and confirm your answers." : "Confirm three answers.",
    });
  }
  if (!hasVerifiedNotify(tenant, meta) || team < 100) {
    gaps.push({
      domain: "team_notify",
      action: hasAlert
        ? "Review and confirm who we alert."
        : "Set a WhatsApp or email alert and confirm notify routing.",
    });
  }
  if (payments < 50) {
    gaps.push({
      domain: "payments",
      action:
        payment || deposit
          ? "Review and confirm how customers pay."
          : "Add how customers pay (M-Pesa till, paybill, or cash).",
    });
  }

  const ready =
    overall >= 70 &&
    anyOwner(tenant, meta) &&
    faqCount >= 1 &&
    team >= 100 &&
    catalog >= 40 &&
    !seedIdentity(meta);

  return {
    overall: round(overall),
    domains: {
      identity: round(identity),
      catalog: round(catalog),
      hours: round(hours),
      locations: round(locations),
      payments: round(payments),
      policies: round(policiesScore),
      faqs: round(faqs),
      team_notify: round(team),
      assistant: round(assistant),
      bulletin: round(bulletin),
    },
    ready_badge: ready,
    next_gaps: gaps,
  };
}

export function holdCaptureTenant(
  tenant: ScoreTenant,
  meta: ProvenanceMeta = {}
): CaptureHold {
  const policies = policyRecord(tenant.business_policies);
  const reasons: string[] = [];
  if (!holdsAllowed(policies, meta)) {
    reasons.push("Holds are not enabled in policies.");
  }
  if (!ownerConfirmedProduct(tenant.product_catalog, meta)) {
    reasons.push("Need an owner-confirmed catalogue.");
  }
  if (!hasVerifiedNotify(tenant, meta)) {
    reasons.push("Need a verified notify target (WhatsApp or email alerts).");
  }
  return { allowed: reasons.length === 0, reasons };
}
