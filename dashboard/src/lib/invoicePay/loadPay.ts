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
    checkout = {
      id: checkoutId,
      status: attempt?.status || "pending",
      returning: true,
    };
  }
  return payView({ lookup, checkout });
}
