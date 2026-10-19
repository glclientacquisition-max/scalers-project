import { invoicePayLedger } from "./ledger";
import { payView } from "./view";
import { readPayReturn } from "./returnUrl";

export async function loadPayView(
  token: string,
  search: { return?: string; checkout_id?: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const ledger = invoicePayLedger(env);
  const lookup = await ledger.lookup(token);
  const normalized = readPayReturn(search);
  const checkoutId = normalized.checkout_id || "";
  const returning = normalized.return === "1" && Boolean(checkoutId);
  let checkout = null;
  if (returning) {
    const attempt = await ledger.findAttemptByCheckout(checkoutId);
    const sameInvoice =
      Boolean(attempt) &&
      lookup.found === true &&
      Boolean(lookup.invoiceId) &&
      attempt?.invoiceId === lookup.invoiceId;
    if (sameInvoice && attempt) {
      checkout = {
        id: checkoutId,
        status: attempt.status || "pending",
        returning: true,
      };
    }
  }
  return payView({ lookup, checkout });
}

/** Status page for a Bachs return id. The id is not a pay token. */
export async function loadPayReturn(
  returnId: string,
  search: { return?: string; checkout_id?: string },
  token: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const ledger = invoicePayLedger(env) as ReturnLedger;
  const byReturn = await ledger.lookupReturn(returnId);
  if (!byReturn?.found) return payView({ lookup: { found: false } });
  if (token) {
    const lookup = await ledger.lookup(token);
    if (lookup.found && lookup.invoiceId && lookup.invoiceId === byReturn.invoiceId) {
      const checkoutId = search.checkout_id || byReturn.checkoutSessionId || "";
      return loadPayView(token, { return: "1", checkout_id: checkoutId }, env);
    }
  }
  const view = payView({
    lookup: byReturn,
    checkout: byReturn.checkoutSessionId
      ? { id: byReturn.checkoutSessionId, status: byReturn.attemptStatus || "pending", returning: true }
      : null,
  });
  return { ...view, payLabel: null };
}

type ReturnLedger = {
  lookup: (token: string) => Promise<{ found: boolean; invoiceId?: string }>;
  lookupReturn: (returnId: string) => Promise<{
    found: boolean;
    invoiceId?: string;
    checkoutSessionId?: string | null;
    attemptStatus?: string | null;
    state?: string;
    businessName?: string;
    invoiceNumber?: string;
    totalKes?: string;
    amountPaidKes?: string;
    dueAt?: string | null;
  }>;
};
