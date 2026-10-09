import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { indexFieldMeta } from "@/lib/provenance";

export type TenantCompletenessScore = {
  overall: number;
  domains: Record<string, number>;
  ready_badge: boolean;
  next_gaps: Array<{ domain?: string; action?: string }>;
};

export type TenantHoldGate = {
  allowed: boolean;
  reasons: string[];
};

export type TenantFieldMetaRow = {
  field_path: string;
  source: string;
  confirmed_by?: string | null;
  confirmed_at?: string | null;
  last_verified_at?: string | null;
  stale_after_days?: number | null;
  /** Present only once tenant_field_confirm_v2.sql is applied. */
  value_hash?: string | null;
};

// Same step-down as src/lib/tenantFieldMetaSelect.js: a DB without value_hash
// (or the freshness columns) still loads provenance under the P0 rules.
const FIELD_META_COLUMN_SETS = [
  "field_path, source, confirmed_by, confirmed_at, last_verified_at, stale_after_days, value_hash",
  "field_path, source, confirmed_by, confirmed_at, last_verified_at, stale_after_days",
  "field_path, source, confirmed_by, confirmed_at",
];

function isMissingFieldMetaColumn(error: { code?: string; message?: string; details?: string; hint?: string } | null) {
  if (!error) return false;
  const text = `${error.code || ""} ${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  if (!/value_hash|last_verified_at|stale_after_days/i.test(text)) return false;
  return /42703|PGRST204|does not exist|could not find|schema cache/i.test(text);
}

function parseHoldGate(raw: unknown): TenantHoldGate {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const reasonsRaw = row.reasons;
  const reasons = Array.isArray(reasonsRaw)
    ? reasonsRaw.map((r) => String(r))
    : [];
  return {
    allowed: row.allowed === true,
    reasons,
  };
}

function parseCompleteness(raw: unknown): TenantCompletenessScore | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const domains =
    row.domains && typeof row.domains === "object"
      ? (row.domains as Record<string, number>)
      : {};
  const gaps = Array.isArray(row.next_gaps) ? row.next_gaps : [];
  return {
    overall: Number(row.overall ?? 0),
    domains,
    ready_badge: row.ready_badge === true,
    next_gaps: gaps as TenantCompletenessScore["next_gaps"],
  };
}

export async function getTenantCompletenessScore(
  tenantId: string
): Promise<TenantCompletenessScore | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("tenant_completeness_score", {
    p_tenant_id: tenantId,
  });
  if (error) {
    console.warn("[tenantFieldProvenance] tenant_completeness_score", error.message);
    return null;
  }
  return parseCompleteness(data);
}

export async function getTenantHoldGate(tenantId: string): Promise<TenantHoldGate | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("tenant_hold_gate", {
    p_tenant_id: tenantId,
  });
  if (error) {
    console.warn("[tenantFieldProvenance] tenant_hold_gate", error.message);
    return null;
  }
  return parseHoldGate(data);
}

/** Null when the table is not migrated yet. Empty array means no rows for this tenant. */
export async function listTenantFieldMeta(tenantId: string): Promise<TenantFieldMetaRow[] | null> {
  if (!tenantId) return null;
  const supabase = await createSupabaseServerClient();
  let data: unknown = null;
  let error: { code?: string; message?: string; details?: string; hint?: string } | null = null;
  for (const columns of FIELD_META_COLUMN_SETS) {
    const res = await supabase.from("tenant_field_meta").select(columns).eq("tenant_id", tenantId);
    data = res.data;
    error = res.error;
    if (!error || !isMissingFieldMetaColumn(error)) break;
  }
  if (error) {
    if (/tenant_field_meta|does not exist|schema cache/i.test(error.message || "")) return null;
    console.warn("[tenantFieldProvenance] tenant_field_meta", error.message);
    return null;
  }
  return Array.isArray(data) ? (data as TenantFieldMetaRow[]) : [];
}

export async function upsertTenantFieldMeta(input: {
  tenantId: string;
  fieldPath: string;
  source: "owner" | "seed" | "import" | "inferred" | "call_suggested";
  sourceRef?: string | null;
  confidence?: number | null;
  staleAfterDays?: number | null;
  actor?: string;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc("upsert_tenant_field_meta", {
    p_tenant_id: input.tenantId,
    p_field_path: input.fieldPath,
    p_source: input.source,
    p_source_ref: input.sourceRef ?? null,
    p_confidence: input.confidence ?? null,
    p_stale_after_days: input.staleAfterDays ?? null,
    p_actor: input.actor ?? "desk",
    p_old_value: input.oldValue ?? null,
    p_new_value: input.newValue ?? null,
  });
}

/** Index meta rows and the hold gate for compile. Null fields keep the pack heuristic. */
export async function loadCompileProvenance(tenantId: string) {
  if (!tenantId) return { fieldMeta: null, holdGate: null };
  const [rows, gate] = await Promise.all([
    listTenantFieldMeta(tenantId),
    getTenantHoldGate(tenantId),
  ]);
  const fieldMeta = indexFieldMeta(rows);
  const reasons = Array.isArray(gate?.reasons) ? gate.reasons.map((reason) => String(reason)) : [];
  const holdGate =
    gate && typeof gate.allowed === "boolean" && !reasons.includes("provenance_rpc_missing")
      ? { allowed: gate.allowed === true, reasons }
      : null;
  return { fieldMeta, holdGate };
}

export async function confirmTenantField(input: {
  tenantId: string;
  fieldPath: string;
  userId?: string | null;
}) {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc("confirm_tenant_field", {
    p_tenant_id: input.tenantId,
    p_field_path: input.fieldPath,
    p_user_id: input.userId ?? null,
  });
}
