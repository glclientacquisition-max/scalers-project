"use server";

import { isAuthenticated } from "@/lib/auth";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import {
  getWalletTopUpConfig,
  normalizeTopUpAmountKes,
  processWalletTopUp,
} from "@/lib/walletTopUp";

export type WalletTopUpState = {
  ok?: boolean;
  error?: string;
  message?: string;
};

/**
 * Owner-initiated prepaid top-up. Plug in M-Pesa/Paystack by setting:
 * WALLET_TOPUP_ENABLED=true, WALLET_TOPUP_PROVIDER=mpesa|paystack, plus provider keys.
 */
export async function initiateWalletTopUp(
  _prev: WalletTopUpState,
  formData: FormData
): Promise<WalletTopUpState> {
  if (!(await isAuthenticated())) {
    return { error: "Sign in to top up." };
  }

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return { error: "No workspace linked to this account." };
  }

  const id = String(formData.get("tenant_id") || "").trim();
  if (!id || id !== tenant.id) {
    return { error: "Forbidden." };
  }

  const config = getWalletTopUpConfig();
  if (!config.enabled || !config.provider) {
    return {
      error:
        "Online top-up is not enabled yet. Ops can turn on WALLET_TOPUP_ENABLED when M-Pesa is live.",
    };
  }

  const amountKes = normalizeTopUpAmountKes(formData.get("amount_kes"));
  if (amountKes == null) {
    return { error: "Enter an amount between KES 100 and KES 150,000." };
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return { error: "Not signed in." };
  }

  const phone =
    String(tenant.whatsapp_notification_number || "").trim() ||
    String(formData.get("phone") || "").trim();
  if (!phone.replace(/\D/g, "")) {
    return { error: "Add your alert WhatsApp number in Business settings first." };
  }

  const result = await processWalletTopUp({
    provider: config.provider,
    tenantId: tenant.id,
    amountKes,
    phone,
    businessName: tenant.business_name || "workspace",
  });

  if (result.error) {
    return { error: result.error };
  }

  return {
    ok: true,
    message:
      result.message ||
      "Top-up started. Complete the payment on your phone to credit prepaid.",
  };
}
