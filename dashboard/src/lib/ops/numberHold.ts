/**
 * Number hold / win-back (Admin s28). Pure helpers — no React, no fetch.
 * SQL writers live in draft #885 (docs/supabase/number_hold_winback.sql).
 * Hold is Scalers' choice per number (default 14 days). Platform Off → no new holds.
 */

export type HoldPolicy = {
  /** False when #885 columns are not on this environment. */
  columnsPresent: boolean;
  enabled: boolean;
  defaultDays: number;
  reactivationFeeKes: number | null;
};

export type HoldReleaseMode = "hold" | "free";

export type NumberHoldActions = {
  /** Offer Hold vs Free on release / archive-release. */
  chooseOnRelease: boolean;
  /** Quarantine row not yet marked win-back — put on win-back hold. */
  startHold: boolean;
  /** Live win-back hold — end early (pool Available). */
  endHold: boolean;
  /** Live win-back hold — restore to last business (must be on a package). */
  restore: boolean;
  whyOff: string | null;
};

export const HOLD_SQL_MISSING =
  "Number hold is not on this database yet. Apply the hold SQL on staging first (#885).";

export const REACTIVATION_INVOICE_TODO =
  "Reactivation fee is set in Settings. Adding it as a package-invoice line at checkout is still to wire (Invoicing). Admin restore does not charge.";

export function clampHoldDays(n: number | null | undefined, fallback = 14): number {
  const v = Number.isFinite(n) ? Math.trunc(Number(n)) : fallback;
  if (v < 1) return 1;
  if (v > 90) return 90;
  return v;
}

export function holdPolicyFromSettings(raw: {
  holdColumns?: boolean;
  hold_winback_enabled?: boolean | null;
  number_hold_days?: number | null;
  reactivation_fee_kes?: number | null;
} | null): HoldPolicy {
  const columnsPresent = !!raw && raw.holdColumns !== false;
  return {
    columnsPresent,
    enabled: columnsPresent && raw!.hold_winback_enabled !== false,
    defaultDays: clampHoldDays(raw?.number_hold_days, 14),
    reactivationFeeKes:
      raw?.reactivation_fee_kes == null || !Number.isFinite(Number(raw.reactivation_fee_kes))
        ? null
        : Number(raw.reactivation_fee_kes),
  };
}

/**
 * Which hold CTAs to show for a selected number.
 * state: numbersView numberState(); winbackHold from pool.winback_hold.
 */
export function numberHoldActions(opts: {
  state: string | null;
  winbackHold: boolean;
  policy: HoldPolicy;
  lastBusinessId: string | null;
}): NumberHoldActions {
  const { state, winbackHold, policy, lastBusinessId } = opts;
  if (!policy.columnsPresent) {
    return {
      chooseOnRelease: false,
      startHold: false,
      endHold: false,
      restore: false,
      whyOff: HOLD_SQL_MISSING,
    };
  }
  if (!policy.enabled) {
    return {
      chooseOnRelease: false,
      startHold: false,
      endHold: state === "held" && winbackHold,
      restore: state === "held" && winbackHold && Boolean(lastBusinessId),
      whyOff: "Hold and win-back is Off in Settings. Running holds can still end or restore.",
    };
  }
  const onHold = state === "held" && winbackHold;
  return {
    chooseOnRelease: state === "assigned",
    startHold: state === "held" && !winbackHold,
    endHold: onHold,
    restore: onHold && Boolean(lastBusinessId),
    whyOff: null,
  };
}

export function feeLabel(kes: number | null): string {
  if (kes == null) return "No reactivation fee set";
  return `KSh ${kes.toLocaleString("en-KE")}`;
}

export type ReactivationFeeSurface = {
  kes: number | null;
  label: string;
  /** Always false until Invoicing adds the invoice line. */
  canBillFromAdmin: boolean;
  note: string;
};

export function reactivationFeeSurface(kes: number | null | undefined): ReactivationFeeSurface {
  const amount = kes == null || !Number.isFinite(Number(kes)) ? null : Number(kes);
  return {
    kes: amount,
    label: feeLabel(amount),
    canBillFromAdmin: false,
    note: REACTIVATION_INVOICE_TODO,
  };
}

/** Honest API body when someone tries to bill the fee from Admin. Never ok:true. */
export function reactivationFeeBillStub(): { ok: false; error: string; todo: "invoice_line" } {
  return {
    ok: false,
    error: "Cannot bill the reactivation fee from Admin yet. It will appear on the package invoice at checkout when Invoicing wires the line.",
    todo: "invoice_line",
  };
}
