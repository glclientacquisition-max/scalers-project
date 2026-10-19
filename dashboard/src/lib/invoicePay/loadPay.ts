import { invoicePayLedger } from "./ledger";
import { payView } from "./view";

export async function loadPayView(
  token: string,
  search: { return?: string; checkout_id?: string },
  env: NodeJS.ProcessEnv = process.env
) {
  const ledger = invoicePayLedger(env);
  const lookup = await ledger.lookup(token);
  const checkoutId = search.checkout_id || "";
  const returning = search.return === "1" && Boolean(checkoutId);
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
