/**
 * When confirmPriceAction's value_hash re-stamp fails, the price save still
 * succeeds but the row can drop from the grounded catalogue under
 * FACT_HASH_MODE=on. Surface that without blocking the owner.
 *
 * No usable dashboard ops-alert helper covers this event today
 * (platform_ops_notices kinds are speech/reasoning/phone_line/sautikit_low/
 * pool_empty/beta_expired; platformOpsAlert is voice-runtime only).
 */

export type FactHashRestampFailure = {
  tenantId: string;
  /** catalog.{service|product}.<key>.price — no item name or price text. */
  itemPath: string | null;
  error: string;
};

export function factHashRestampFailurePayload(input: {
  tenantId: string;
  itemPath?: string | null;
  error: unknown;
}): FactHashRestampFailure {
  const msg =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
        ? input.error
        : String(input.error ?? "unknown");
  return {
    tenantId: String(input.tenantId || ""),
    itemPath: input.itemPath ?? null,
    error: msg.slice(0, 500),
  };
}

/** Structured console error. Never throws. */
export function reportFactHashRestampFailure(input: {
  tenantId: string;
  itemPath?: string | null;
  error: unknown;
}): void {
  const payload = factHashRestampFailurePayload(input);
  console.error(
    JSON.stringify({
      event: "fact_hash_restamp_failed",
      ...payload,
    }),
  );
}
