/**
 * Changed-only owner confirm (GIGO confirm v2, FACT_HASH_MODE on).
 *
 * A Settings save confirms a fact only when its value changed, compared by the
 * shared fact hash (Brain's factHash: whitespace-only edits hash the same).
 * Untouched fields keep their source, so seed and import stay "Check this".
 * A field cleared to empty reopens. A "Looks right" path confirms the current
 * value even when nothing changed. Hashes come from the SAVED tenants row.
 *
 * Pure. Relative imports only so node tests can load it.
 */

import { factValueForPath, hashFactValue, stableRowId } from "./factHash";

export const FACT_HASH_RE = /^[0-9a-f]{64}$/;
export const CONFIRM_BATCH_MAX = 500;

/** Policy text keys a Policies save owns (POLICY_FIELDS ids in businessPolicies). */
export const POLICY_TEXT_KEYS = [
  "payment",
  "deposit",
  "returns",
  "delivery",
  "cancellation",
  "warranty",
  "other",
] as const;

type Row = Record<string, unknown>;

export type FactConfirmPlan = {
  confirm: Array<{ path: string; hash: string }>;
  reopen: string[];
};

function asList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Empty means nothing to confirm: null, blank text, [], {}, a catalogue row
 * with no name, or a FAQ missing its question or answer.
 */
export function isEmptyFactValue(value: unknown, path = ""): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    const obj = value as Row;
    if (!Object.keys(obj).length) return true;
    if (path.startsWith("catalog.")) return !String(obj.name ?? "").trim();
    if (path.startsWith("faqs.")) {
      return !String(obj.question ?? "").trim() || !String(obj.answer ?? "").trim();
    }
  }
  return false;
}

function catalogPaths(row: Row, kind: "service" | "product"): string[] {
  const list = asList(kind === "service" ? row.services_catalog : row.product_catalog);
  return list.map((item, index) => {
    if (kind === "service") {
      return `catalog.service.${stableRowId(item) || String(index + 1)}.name`;
    }
    const sku = String((item as Row | null)?.sku ?? "").trim();
    return `catalog.product.${sku || String(index + 1)}.name`;
  });
}

const SCOPE_SCALARS: Record<string, string[]> = {
  identity: [
    "identity.business_name",
    "identity.vertical",
    "identity.spoken_name",
    "identity.social_handles",
    "assistant.agent_name",
    "assistant.tone",
  ],
  hours: ["hours.weekly_grid"],
  locations: ["locations.branches"],
  policies: [
    ...POLICY_TEXT_KEYS.map((key) => `policies.${key}`),
    "payments.methods",
    "policies.coverage_areas",
  ],
  tools: ["assistant.tools"],
};

const KNOWN_SCOPES = new Set(["identity", "catalog", "hours", "locations", "policies", "tools", "pronunciation", "team", "faqs"]);

/** Fact paths a scoped Settings save owns, as they appear in one tenants row. */
export function scopeFactPaths(scope: string, row: Row): string[] {
  const s = String(scope || "").trim();
  // Unknown scope = older client posting the whole form: every section.
  const all = !KNOWN_SCOPES.has(s);
  const out: string[] = [];
  for (const [key, paths] of Object.entries(SCOPE_SCALARS)) {
    if (all || key === s) out.push(...paths);
  }
  if (all || s === "catalog") {
    out.push(...catalogPaths(row, "service"), ...catalogPaths(row, "product"));
  }
  if (all || s === "faqs") {
    asList(row.faqs).forEach((_, index) => out.push(`faqs.${index + 1}`));
  }
  return out;
}

function listKind(path: string): string | null {
  if (path.startsWith("catalog.service.")) return "service";
  if (path.startsWith("catalog.product.")) return "product";
  if (path.startsWith("faqs.")) return "faq";
  return null;
}

function hashOrNull(value: unknown, path: string): string | null {
  return value === undefined || isEmptyFactValue(value, path) ? null : hashFactValue(value);
}

/** Row content without its stable id, so a row that only gained an id is not "new". */
function contentHash(value: unknown, path: string): string | null {
  if (value && typeof value === "object" && !Array.isArray(value) && path.startsWith("catalog.")) {
    const rest = { ...(value as Row) };
    delete rest.id;
    return hashOrNull(rest, path);
  }
  return hashOrNull(value, path);
}

/**
 * Which paths to confirm (with the saved value's hash) and which to reopen.
 * `before` is the stored row ahead of the save, `after` the saved row.
 * `normalize` puts both rows in one normal form before the diff (Settings
 * passes normalizeFactRow), so a raw seed row never looks changed against its
 * parsed copy. The stamped hash is always taken from `after` as saved:
 * hashFactValue(factValueForPath(path, after)).
 * A list row that only moved (its value already existed in the same list
 * before the save) is not a change, so a delete never confirms its neighbours
 * and a service that only gained its stable id is not confirmed either.
 */
export function planFactConfirm(input: {
  scope: string;
  before: Row;
  after: Row;
  explicitPaths?: string[];
  normalize?: (row: Row) => Row;
}): FactConfirmPlan {
  const normalize = input.normalize || ((row: Row) => row);
  const saved = input.after || {};
  const before = normalize(input.before || {});
  const after = normalize(saved);
  const savedHash = (path: string) => hashOrNull(factValueForPath(path, saved), path);
  const paths = new Set<string>([
    ...scopeFactPaths(input.scope, before),
    ...scopeFactPaths(input.scope, after),
  ]);

  const beforeListHashes = new Map<string, Set<string>>();
  for (const path of scopeFactPaths(input.scope, before)) {
    const kind = listKind(path);
    if (!kind) continue;
    const h = contentHash(factValueForPath(path, before), path);
    if (!h) continue;
    if (!beforeListHashes.has(kind)) beforeListHashes.set(kind, new Set());
    beforeListHashes.get(kind)!.add(h);
  }

  // List rows that now sit under a stable key they did not have before (a
  // service that just got its svc_ id). Their old positional path empties, but
  // the fact did not go anywhere, so it is not reopened.
  const beforePaths = new Set(scopeFactPaths(input.scope, before));
  const rekeyedHashes = new Map<string, Set<string>>();
  for (const path of scopeFactPaths(input.scope, after)) {
    const kind = listKind(path);
    if (!kind || kind === "faq" || beforePaths.has(path)) continue;
    if (/^\d+$/.test(path.split(".")[2] || "")) continue;
    const h = contentHash(factValueForPath(path, after), path);
    if (!h) continue;
    if (!rekeyedHashes.has(kind)) rekeyedHashes.set(kind, new Set());
    rekeyedHashes.get(kind)!.add(h);
  }

  const confirm = new Map<string, string>();
  const reopen = new Set<string>();

  for (const path of paths) {
    const now = factValueForPath(path, after);
    if (now === undefined) continue;
    const prevHash = hashOrNull(factValueForPath(path, before), path);
    const nowHash = hashOrNull(now, path);
    if (!nowHash) {
      const kind = listKind(path);
      const prevContent = contentHash(factValueForPath(path, before), path) || "";
      const rekeyed = kind ? rekeyedHashes.get(kind)?.has(prevContent) : false;
      if (prevHash && !rekeyed) reopen.add(path);
      continue;
    }
    if (nowHash === prevHash) continue;
    const kind = listKind(path);
    if (kind && beforeListHashes.get(kind)?.has(contentHash(now, path) || "")) continue;
    const stamp = savedHash(path);
    if (stamp) confirm.set(path, stamp);
  }

  for (const raw of input.explicitPaths || []) {
    const path = String(raw || "").trim();
    if (!path || confirm.has(path)) continue;
    const stamp = savedHash(path);
    if (stamp) confirm.set(path, stamp);
  }

  return {
    confirm: [...confirm].map(([path, hash]) => ({ path, hash })),
    reopen: [...reopen].filter((path) => !confirm.has(path)),
  };
}

/**
 * fieldMeta index (Brain's indexFieldMeta shape) with a pending plan applied,
 * so the compile that runs before the write already sees the owner's confirm.
 */
export function overlayFieldMeta<T>(fieldMeta: T, plan: FactConfirmPlan): T {
  if (!fieldMeta || typeof fieldMeta !== "object") return fieldMeta;
  const base = fieldMeta as unknown as { byPath?: Record<string, Row> };
  const byPath: Record<string, Row> = { ...(base.byPath || {}) };
  for (const { path, hash } of plan.confirm) {
    byPath[path] = { ...(byPath[path] || {}), source: "owner", value_hash: hash };
  }
  for (const path of plan.reopen) {
    if (!byPath[path]) continue;
    const next = { ...byPath[path] };
    delete next.value_hash;
    byPath[path] = next;
  }
  return { ...(fieldMeta as object), byPath } as T;
}

/** Validate a batch before it goes to confirm_tenant_fields. */
export function validConfirmBatch(plan: FactConfirmPlan): boolean {
  if (plan.confirm.length > CONFIRM_BATCH_MAX) return false;
  const seen = new Set<string>();
  for (const { path, hash } of plan.confirm) {
    if (!path || seen.has(path) || !FACT_HASH_RE.test(hash)) return false;
    seen.add(path);
  }
  return true;
}
