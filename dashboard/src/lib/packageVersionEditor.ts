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
  "inbound_kes_per_second",
  "outbound_kes_per_second",
  "annual_discount_percent",
] as const;

export type EditorCommand =
  | { action: "draft"; sku: string; reason: string }
  | { action: "update_draft"; versionId: string; patch: Record<string, unknown>; reason: string }
  | { action: "publish"; versionId: string; activeFrom: string; reason: string }
  | { action: "archive"; versionId: string; reason: string }
  | { action: "discard_draft"; versionId: string; reason: string }
  | { action: "approve"; versionId: string; reason: string }
  | { action: "move_subscribers"; versionId: string; tenantIds: string[]; reason: string }
  | { action: "set_price_approval_threshold"; thresholdKes: number | null; reason: string };

export type ParsedEditorCommand =
  | { ok: true; command: EditorCommand }
  | { ok: false; error: string };

/** Production writes stay off unless Alvin's flag is exactly `on`. */
export function packageEditorWritesAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = `${env.SUPABASE_URL || ""} ${env.NEXT_PUBLIC_SUPABASE_URL || ""}`;
  if (!url.includes(PROD_SUPABASE_PROJECT_REF)) return true;
  return env.ADMIN_PACKAGE_EDITOR_ALLOW_PROD === "on";
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
    text.includes("notes must") ||
    text.includes("promote file") ||
    text.includes("say who") ||
    text.includes("approval threshold") ||
    text.includes("allowances placeholder") ||
    text.includes("message credits")
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
  if ((patch.annual_discount_percent as number) > 100) return null;
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
    const tenantIds: string[] = [];
    for (const id of body.tenant_ids) {
      const tenantId = uuidOf(id);
      if (!tenantId) return { ok: false, error: "Business not found." };
      tenantIds.push(tenantId);
    }
    return { ok: true, command: { action, versionId, tenantIds, reason } };
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
