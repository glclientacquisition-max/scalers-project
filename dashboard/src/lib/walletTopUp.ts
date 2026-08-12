/** KES amount presets for owner wallet top-up (M-Pesa STK / Paystack). */
export const WALLET_TOPUP_PRESETS_KES = [500, 1000, 2000, 5000] as const;

export const WALLET_TOPUP_MIN_KES = 100;
export const WALLET_TOPUP_MAX_KES = 150_000;

export type WalletTopUpProvider = "mpesa" | "paystack";

export type WalletTopUpConfig = {
  enabled: boolean;
  provider: WalletTopUpProvider | null;
  presets: readonly number[];
};

export type WalletTopUpResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  checkoutUrl?: string;
};

/** True when owner self-serve top-up is wired (env + provider). */
export function getWalletTopUpConfig(): WalletTopUpConfig {
  const raw = String(process.env.WALLET_TOPUP_PROVIDER || "")
    .trim()
    .toLowerCase();
  const provider =
    raw === "mpesa" || raw === "paystack" ? (raw as WalletTopUpProvider) : null;
  const enabled =
    process.env.WALLET_TOPUP_ENABLED === "true" && provider !== null;

  return {
    enabled,
    provider,
    presets: WALLET_TOPUP_PRESETS_KES,
  };
}

export function normalizeTopUpAmountKes(raw: unknown): number | null {
  const n =
    typeof raw === "number"
      ? raw
      : Number(String(raw ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < WALLET_TOPUP_MIN_KES || rounded > WALLET_TOPUP_MAX_KES) {
    return null;
  }
  return rounded;
}

function mpesaEnvReady(): boolean {
  return Boolean(
    process.env.MPESA_CONSUMER_KEY &&
      process.env.MPESA_CONSUMER_SECRET &&
      process.env.MPESA_PASSKEY &&
      process.env.MPESA_SHORTCODE
  );
}

/**
 * Initiate owner top-up. Ledger credit happens in the payment callback
 * (service role → `topup` ledger row). Desk only starts the provider flow.
 */
export async function processWalletTopUp(opts: {
  provider: WalletTopUpProvider;
  tenantId: string;
  amountKes: number;
  phone: string;
  businessName: string;
}): Promise<WalletTopUpResult> {
  if (opts.provider === "mpesa") {
    if (!mpesaEnvReady()) {
      return {
        error:
          "M-Pesa is not configured on the server. Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY, and MPESA_SHORTCODE.",
      };
    }

    // Hook: call Safaricom STK push here, then return checkout message.
    // Callback route credits wallet via service-role topup RPC.
    void opts.tenantId;
    void opts.phone;
    void opts.businessName;

    return {
      error:
        "M-Pesa STK push is not implemented yet. Wire Safaricom STK in processWalletTopUp and credit wallet on callback.",
    };
  }

  if (opts.provider === "paystack") {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return { error: "Paystack is not configured. Set PAYSTACK_SECRET_KEY." };
    }
    return {
      error:
        "Paystack checkout is not implemented yet. Wire initialize transaction and credit wallet on webhook.",
    };
  }

  return { error: "Unknown payment provider." };
}
