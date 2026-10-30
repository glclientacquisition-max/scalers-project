import type { PublicPackageBoard } from "../../lib/packageCatalog";
import { formatKes } from "../../lib/packagePriceLabel.ts";

/** Worked example length. The cost is always computed from the live rate, never written down. */
export const EXAMPLE_MINUTES = 3;

export const kes = (n: number) => `KES ${formatKes(n)}`;

/** Usage rows from the live rate card (billing_rate_card via packageCatalog). A zero rate is not shown. */
export function usageRows(board: PublicPackageBoard): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (board.inboundKesPerMinute > 0) rows.push(["Answered calls", `${kes(board.inboundKesPerMinute)} a minute`]);
  if (board.smsKes > 0) rows.push(["SMS", `${kes(board.smsKes)} each`]);
  if (board.emailKes > 0) rows.push(["Email", `${kes(board.emailKes)} each`]);
  if (board.whatsappKes > 0) rows.push(["WhatsApp", `${kes(board.whatsappKes)} each`]);
  return rows;
}

/** "A 3-minute answered call costs KES 18." from the live per-minute rate; null when there is no rate. */
export function workedExample(board: PublicPackageBoard): string | null {
  if (!(board.inboundKesPerMinute > 0)) return null;
  const cost = Math.round(board.inboundKesPerMinute * EXAMPLE_MINUTES * 100) / 100;
  return `${kes(cost)}`;
}
