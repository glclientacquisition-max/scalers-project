/**
 * Package version editor checks that do not touch the database.
 * The SQL functions in docs/supabase/package_version_editor.sql are the source of truth.
 * Node tests load this file. It must not import Next or the service-role client.
 */

export const PROD_SUPABASE_PROJECT_REF = "fjxcdccgyhnvnnlnovcl";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKU_RE = /^[a-z][a-z0-9_-]{1,31}$/;

const COUNT_KEYS = [
  "seats",
  "minutes",
  "message_credits",
  "sms_credit_burn",
  "whatsapp_credit_burn",
  "email_credit_burn",
  "dids",
] as const;
const MONEY_KEYS = [
  "monthly_price_kes",
  "annual_price_kes",
  "credit_kes",
  "spend_limit_share_percent",
  "inbound_kes_per_second",
  "outbound_kes_per_second",
] as const;

export type EditorCommand =
  | { action: "draft"; sku: string; reason: string }
  | { action: "update_draft"; versionId: string; patch: Record<string, unknown>; reason: string }
  | { action: "publish"; versionId: string; activeFrom: string; reason: string }
  | { action: "archive"; versionId: string; reason: string }
  | { action: "discard_draft"; versionId: string; reason: string }
  | { action: "approve"; versionId: string; reason: string }
  | { action: "move_subscribers"; versionId: string; tenantIds: string[]; reason: string; confirm: true }
  | { action: "set_billing_mode"; tenantId: string; billingStatus: "beta" | "active"; enforcement: "off" | "soft" | "hard"; reason: string; confirm: true }
  | { action: "set_new_signup_trial"; enabled: boolean; reason: string; confirm: true }
  | { action: "set_price_approval_threshold"; thresholdKes: number | null; reason: string };

export type ParsedEditorCommand =
  | { ok: true; command: EditorCommand }
  | { ok: false; error: string };

/** Super Admin auth is the write gate. Host and env do not block plan edits. */
export function packageEditorWritesAllowed(_env?: NodeJS.ProcessEnv): boolean {
  void _env;
  return true;
}

export function packageVersionEditorHttpStatus(message: string): { status: number; error: string } | null {
  const text = message.toLowerCase();
  if (text.includes("needs a second admin")) return { status: 409, error: "approval_required" };
  if (text.includes("draft already exists")) return { status: 409, error: "draft_exists" };
  if (text.includes("frozen")) return { status: 409, error: "version_frozen" };
  if (text.includes("editor is off") || text.includes("package editor is off")) {
    return { status: 403, error: "package_editor_off" };
  }
  if (
    text.includes("zero or more") ||
    text.includes("reason is required") ||
    text.includes("trial length") ||
    text.includes("only a trial") ||
    text.includes("not a draft") ||
    text.includes("published version") ||
    text.includes("features") ||
    text.includes("unknown feature") ||
    text.includes("package not found") ||
    text.includes("active from") ||
    text.includes("your own price") ||
    text.includes("does not need a second admin") ||
    text.includes("choose at least one") ||
    text.includes("too many businesses") ||
    text.includes("not on this package") ||
    text.includes("business not found") ||
    text.includes("discount") ||
    text.includes("annual price") ||
    text.includes("spend limit") ||
    text.includes("notes must") ||
    text.includes("promote file") ||
    text.includes("say who") ||
    text.includes("approval threshold") ||
    text.includes("allowances placeholder") ||
    text.includes("message credits") ||
    text.includes("on-demand setting") ||
    text.includes("beta business") ||
    text.includes("confirm the move") ||
    text.includes("confirm the billing change") ||
    text.includes("confirm the signup setting") ||
    text.includes("set billing mode before active") ||
    text.includes("billing stays off") ||
    text.includes("billing mode must be") ||
    text.includes("billing status") ||
    text.includes("billing enforcement") ||
    text.includes("new signup trial") ||
    text.includes("must not create an invoice")
  ) {
    return { status: 400, error: "invalid" };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function reasonOf(body: Record<string, unknown>): string | null {
  if (typeof body.reason !== "string") return null;
  const reason = body.reason.trim();
  if (!reason || reason.length > 500) return null;
  return reason;
}

function uuidOf(value: unknown): string | null {
  if (typeof value !== "string" || !UUID_RE.test(value)) return null;
  return value;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function countValue(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || n < 0 || !Number.isInteger(n) || n > 1000000) return null;
  return n;
}

function moneyValue(value: unknown): number | null {
  const n = finiteNumber(value);
  if (n === null || n < 0 || n > 100000000) return null;
  return n;
}

function featuresOf(value: unknown): Array<{ key: string; enabled: boolean }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const features: Array<{ key: string; enabled: boolean }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.key !== "string" || !item.key.trim()) return null;
    if (typeof item.enabled !== "boolean") return null;
    if (seen.has(item.key)) return null;
    seen.add(item.key);
    features.push({ key: item.key, enabled: item.enabled });
  }
  return features;
}

function patchOf(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const patch: Record<string, unknown> = {};
  for (const key of COUNT_KEYS) {
    const n = countValue(value[key]);
    if (n === null) return null;
    patch[key] = n;
  }
  for (const key of MONEY_KEYS) {
    const n = moneyValue(value[key]);
    if (n === null) return null;
    patch[key] = n;
  }
  if ((patch.spend_limit_share_percent as number) > 100) return null;
  const monthly = patch.monthly_price_kes as number;
  const annual = patch.annual_price_kes as number;
  if (monthly === 0 ? annual !== 0 : annual > monthly * 12) return null;
  if ("extra_seat_monthly_kes" in value) {
    if (value.extra_seat_monthly_kes === null) {
      patch.extra_seat_monthly_kes = null;
    } else {
      const extra = moneyValue(value.extra_seat_monthly_kes);
      if (extra === null) return null;
      patch.extra_seat_monthly_kes = extra;
    }
  }
  if (!("trial_days" in value)) return null;
  if (value.trial_days === null) {
    patch.trial_days = null;
  } else {
    const days = countValue(value.trial_days);
    if (days === null || days < 1 || days > 90) return null;
    patch.trial_days = days;
  }
  if (typeof value.allowances_placeholder !== "boolean") return null;
  patch.allowances_placeholder = value.allowances_placeholder;
  if (typeof value.on_demand_allowed !== "boolean") return null;
  patch.on_demand_allowed = value.on_demand_allowed;
  const features = featuresOf(value.features);
  if (!features) return null;
  patch.features = features;
  if ("notes" in value && value.notes !== null) {
    if (typeof value.notes !== "string") return null;
    const notes = value.notes.trim();
    if (notes.length > 500) return null;
    patch.notes = notes || null;
  }
  return patch;
}

/**
 * Reads the command Desk sends. The actor is never taken from the body.
 */
export function parseEditorCommand(body: unknown): ParsedEditorCommand {
  if (!isRecord(body) || typeof body.action !== "string") {
    return { ok: false, error: "Unknown action." };
  }
  const reason = reasonOf(body);
  if (!reason) return { ok: false, error: "A reason is required." };
  const action = body.action;

  if (action === "draft") {
    if (typeof body.sku !== "string" || !SKU_RE.test(body.sku)) {
      return { ok: false, error: "Package not found." };
    }
    return { ok: true, command: { action, sku: body.sku, reason } };
  }

  if (action === "update_draft") {
    const versionId = uuidOf(body.version_id);
    const patch = patchOf(body.patch);
    if (!versionId || !patch) return { ok: false, error: "Package numbers must be zero or more." };
    return { ok: true, command: { action, versionId, patch, reason } };
  }

  if (action === "publish") {
    const versionId = uuidOf(body.version_id);
    if (!versionId) return { ok: false, error: "This package version is not a draft." };
    if (typeof body.active_from !== "string" || Number.isNaN(Date.parse(body.active_from))) {
      return { ok: false, error: "Active from is required." };
    }
    return { ok: true, command: { action, versionId, activeFrom: body.active_from, reason } };
  }

  if (action === "archive" || action === "discard_draft" || action === "approve") {
    const versionId = uuidOf(body.version_id);
    if (!versionId) return { ok: false, error: "This package version is not a draft." };
    return { ok: true, command: { action, versionId, reason } };
  }

  if (action === "move_subscribers") {
    const versionId = uuidOf(body.version_id);
    if (!versionId) return { ok: false, error: "Move businesses onto a published version." };
    if (!Array.isArray(body.tenant_ids) || body.tenant_ids.length === 0) {
      return { ok: false, error: "Choose at least one business." };
    }
    if (body.tenant_ids.length > 200) return { ok: false, error: "Too many businesses in one move." };
    if (body.confirm !== true) return { ok: false, error: "Confirm the move." };
    const tenantIds: string[] = [];
    for (const id of body.tenant_ids) {
      const tenantId = uuidOf(id);
      if (!tenantId) return { ok: false, error: "Business not found." };
      tenantIds.push(tenantId);
    }
    return { ok: true, command: { action, versionId, tenantIds, reason, confirm: true } };
  }

  if (action === "set_billing_mode") {
    const tenantId = uuidOf(body.tenant_id);
    if (!tenantId) return { ok: false, error: "Business not found." };
    if (body.billing_status !== "beta" && body.billing_status !== "active") {
      return { ok: false, error: "Billing status must be beta or active." };
    }
    if (body.enforcement !== "off" && body.enforcement !== "soft" && body.enforcement !== "hard") {
      return { ok: false, error: "Billing enforcement must be off, soft, or hard." };
    }
    const legalPair =
      (body.billing_status === "beta" && body.enforcement === "off") ||
      (body.billing_status === "active" && (body.enforcement === "soft" || body.enforcement === "hard"));
    if (!legalPair) {
      return {
        ok: false,
        error: "Billing mode must be beta with enforcement off, or active with enforcement soft or hard.",
      };
    }
    if (body.confirm !== true) return { ok: false, error: "Confirm the billing change." };
    return {
      ok: true,
      command: {
        action,
        tenantId,
        billingStatus: body.billing_status,
        enforcement: body.enforcement,
        reason,
        confirm: true,
      },
    };
  }

  if (action === "set_new_signup_trial") {
    if (typeof body.enabled !== "boolean") {
      return { ok: false, error: "New signup trial must be on or off." };
    }
    if (body.confirm !== true) return { ok: false, error: "Confirm the signup setting." };
    return { ok: true, command: { action, enabled: body.enabled, reason, confirm: true } };
  }

  if (action === "set_price_approval_threshold") {
    if (!("threshold_kes" in body)) {
      return { ok: false, error: "The approval threshold must be zero or more." };
    }
    if (body.threshold_kes === null) {
      return { ok: true, command: { action, thresholdKes: null, reason } };
    }
    const threshold = moneyValue(body.threshold_kes);
    if (threshold === null) return { ok: false, error: "The approval threshold must be zero or more." };
    return { ok: true, command: { action, thresholdKes: threshold, reason } };
  }

  return { ok: false, error: "Unknown action." };
}

/** One Admin Activity row. Package-level writes omit businessId. A move is one row per business. */
export type EditorActivityEntry = {
  action: string;
  businessId?: string | null;
  before?: unknown;
  after?: unknown;
  reason: string;
  detail?: Record<string, unknown>;
};

export type EditorBusinessSnap = {
  id: string;
  business_name?: string | null;
  billing_status?: string | null;
  billing_enforcement?: string | null;
  package_version_id?: string | null;
  minutes_included?: number | null;
};

/** Best-effort snapshot loaded before the write. Missing pieces stay unset. */
export type EditorActivityBefore = {
  version?: Record<string, unknown> | null;
  businesses?: EditorBusinessSnap[];
  signupEnabled?: boolean | null;
  thresholdKes?: number | null;
};

const VERSION_ACTIVITY_KEYS = [
  "sku",
  "name",
  "version",
  "status",
  "monthly_price_kes",
  "annual_price_kes",
  "minutes",
  "seats",
  "message_credits",
  "dids",
  "inbound_kes_per_second",
  "outbound_kes_per_second",
  "credit_kes",
  "trial_days",
  "on_demand_allowed",
  "extra_seat_monthly_kes",
] as const;

const VERSION_NUMBER_KEYS = new Set<string>([
  "version",
  "monthly_price_kes",
  "annual_price_kes",
  "minutes",
  "seats",
  "message_credits",
  "dids",
  "inbound_kes_per_second",
  "outbound_kes_per_second",
  "credit_kes",
  "trial_days",
  "extra_seat_monthly_kes",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function activityNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Same keys on the pre-read row and the RPC version, so Activity only lists real changes. */
export function compactPackageVersion(raw: unknown): Record<string, unknown> | null {
  const row = asRecord(raw);
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const key of VERSION_ACTIVITY_KEYS) {
    if (!(key in row) || row[key] === undefined) continue;
    if (key === "on_demand_allowed") {
      out[key] = row[key] === null ? null : row[key] === true;
      continue;
    }
    out[key] = VERSION_NUMBER_KEYS.has(key) ? activityNumber(row[key]) : row[key];
  }
  return Object.keys(out).length ? out : null;
}

function resultVersion(result: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(result)?.version);
}

function versionDetail(versionId: string, snap: Record<string, unknown> | null): Record<string, unknown> | undefined {
  const detail: Record<string, unknown> = { version_id: versionId };
  if (typeof snap?.sku === "string" && snap.sku) detail.package_sku = snap.sku;
  if (snap?.version != null) detail.version = snap.version;
  return detail;
}

function businessBefore(snap: EditorBusinessSnap | undefined): Record<string, unknown> {
  return {
    package_version_id: snap?.package_version_id ?? null,
    billing_status: snap?.billing_status ?? null,
    billing_enforcement: snap?.billing_enforcement ?? null,
    minutes_included: activityNumber(snap?.minutes_included),
  };
}

/**
 * Activity rows for one successful editor write.
 * Action names match the SQL audit (`_billing_audit`). The route still writes that SQL row.
 */
export function packageEditorActivityEntries(
  command: EditorCommand,
  result: unknown,
  before: EditorActivityBefore = {},
): EditorActivityEntry[] {
  const version = resultVersion(result);
  const snap = compactPackageVersion(version) || compactPackageVersion(before.version);

  switch (command.action) {
    case "draft":
      return [
        {
          action: "draft_package_version",
          reason: command.reason,
          before: null,
          after: compactPackageVersion(version),
          detail: versionDetail(String(version?.id || ""), compactPackageVersion(version)),
        },
      ];
    case "update_draft":
      return [
        {
          action: "update_package_version_draft",
          reason: command.reason,
          before: compactPackageVersion(before.version),
          after: compactPackageVersion(version),
          detail: versionDetail(command.versionId, snap),
        },
      ];
    case "publish":
      return [
        {
          action: "publish_package_version",
          reason: command.reason,
          before: compactPackageVersion(before.version),
          after: compactPackageVersion(version),
          detail: versionDetail(command.versionId, snap),
        },
      ];
    case "archive":
      return [
        {
          action: "archive_package_version",
          reason: command.reason,
          before: compactPackageVersion(before.version),
          after: compactPackageVersion(version),
          detail: versionDetail(command.versionId, snap),
        },
      ];
    case "discard_draft": {
      const prior = compactPackageVersion(before.version);
      return [
        {
          action: "discard_package_version_draft",
          reason: command.reason,
          before: prior,
          after: prior ? { ...prior, status: "discarded" } : { version_id: command.versionId, status: "discarded" },
          detail: versionDetail(command.versionId, prior),
        },
      ];
    }
    case "approve": {
      const prior = compactPackageVersion(before.version);
      const next = compactPackageVersion(version) || prior;
      return [
        {
          action: "approve_package_version",
          reason: command.reason,
          before: prior,
          after: next ? { ...next, approved: true } : { approved: true },
          detail: versionDetail(command.versionId, next),
        },
      ];
    }
    case "move_subscribers": {
      const destination = compactPackageVersion(version);
      const byId = new Map((before.businesses || []).map((row) => [row.id, row]));
      return command.tenantIds.map((tenantId) => {
        const row = byId.get(tenantId);
        const was = businessBefore(row);
        const detail: Record<string, unknown> = {
          to_version_id: command.versionId,
        };
        if (row?.business_name) detail.business_name = row.business_name;
        if (typeof destination?.sku === "string") detail.package_sku = destination.sku;
        if (destination?.version != null) detail.version = destination.version;
        return {
          action: "move_package_version",
          businessId: tenantId,
          reason: command.reason,
          before: was,
          after: {
            ...was,
            package_version_id: command.versionId,
            minutes_included: destination?.minutes ?? was.minutes_included,
          },
          detail,
        };
      });
    }
    case "set_billing_mode": {
      const body = asRecord(result);
      const row = (before.businesses || []).find((item) => item.id === command.tenantId);
      const detail: Record<string, unknown> = {};
      if (row?.business_name) detail.business_name = row.business_name;
      return [
        {
          action: "set_tenant_billing_mode",
          businessId: command.tenantId,
          reason: command.reason,
          before: {
            billing_status: row?.billing_status ?? null,
            billing_enforcement: row?.billing_enforcement ?? null,
          },
          after: {
            billing_status: typeof body?.billing_status === "string" ? body.billing_status : command.billingStatus,
            billing_enforcement:
              typeof body?.billing_enforcement === "string" ? body.billing_enforcement : command.enforcement,
          },
          detail: Object.keys(detail).length ? detail : undefined,
        },
      ];
    }
    case "set_new_signup_trial":
      return [
        {
          action: "set_new_signup_trial",
          reason: command.reason,
          before: { enabled: before.signupEnabled ?? null },
          after: { enabled: command.enabled },
        },
      ];
    case "set_price_approval_threshold":
      return [
        {
          action: "set_price_approval_threshold",
          reason: command.reason,
          before: { threshold_kes: activityNumber(before.thresholdKes) },
          after: { threshold_kes: command.thresholdKes },
        },
      ];
    default: {
      const unreachable: never = command;
      return unreachable;
    }
  }
}
