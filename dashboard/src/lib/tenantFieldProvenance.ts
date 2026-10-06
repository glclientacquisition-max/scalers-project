import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

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
