import type { PublicPackageBoard } from "../../lib/packageCatalog";
import { formatKes } from "../../lib/packagePriceLabel.ts";

/** Worked example length. The cost is always computed from the live rate, never written down. */
export const EXAMPLE_MINUTES = 3;

export const kes = (n: number) => `KES ${formatKes(n)}`;

/** Message rates from the live rate card. The answered-minute price is per package, not this card. */
export function usageRows(board: PublicPackageBoard): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (board.smsKes > 0) rows.push(["SMS", `${kes(board.smsKes)} each`]);
  if (board.emailKes > 0) rows.push(["Email", `${kes(board.emailKes)} each`]);
  if (board.whatsappKes > 0) rows.push(["WhatsApp", `${kes(board.whatsappKes)} each`]);
  return rows;
}

/** "On Starter, a 3-minute answered call costs KES 78." from that package's own minute rate. */
export function workedExample(board: PublicPackageBoard): string | null {
  const starter =
    board.packages.find((pack) => pack.sku.toLowerCase() === "starter") ||
    board.packages.find((pack) => pack.name.toLowerCase() === "starter") ||
    null;
  if (!starter || !(starter.inboundKesPerMinute > 0)) return null;
  const cost = Math.round(starter.inboundKesPerMinute * EXAMPLE_MINUTES * 100) / 100;
  return `On ${starter.name}, a ${EXAMPLE_MINUTES}-minute answered call costs ${kes(cost)}`;
}
