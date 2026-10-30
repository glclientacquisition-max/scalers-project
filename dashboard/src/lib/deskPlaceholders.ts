/**
 * Example pools for the three P0 desk fields only:
 * Callers hear, Catalog paste list, Knowledge import paste.
 * Shop stays on stationery, print, pickup, and delivery.
 */

export const CALLERS_HEAR_POOLS = {
  retail: [
    "Pickup only today",
    "Out of A4 paper today",
    "Printing closes at 4",
    "Delivery only today",
    "Binding is full today",
  ],
  home_services: [
    "Fully booked today",
    "No same-day visits",
    "Carpet cleaning is full",
    "Plumbing calls only",
    "Sofa cleaning tomorrow",
  ],
  hospitality: [
    "Fully booked tonight",
    "No tables tonight",
    "Kitchen closes at 9",
    "Last seating at 8",
    "Rooms are full tonight",
  ],
  general: [
    "Closed today",
    "Short hours today",
    "Back tomorrow",
    "Calls only today",
    "Desk is closed",
  ],
} as const;

/** Paste list shape: name, then optional " - price". */
export const SERVICES_PASTE_POOLS = {
  retail: [
    "Printing - from 500 KES\nBinding\nLamination - quote after count",
    "Business cards - from 800 KES\nFlyers\nStamps - quote after artwork",
    "Photocopy - from 10 KES\nBinding\nDelivery - quote after order",
    "Letterheads - from 1,500 KES\nEnvelopes\nPickup - same day",
  ],
  home_services: [
    "Home cleaning - from 2,500 KES\nPlumbing\nElectrical - quote after visit",
    "Sofa cleaning - from 1,500 KES\nCarpet cleaning\nMattress cleaning - quote after visit",
    "Plumbing - quote after visit\nElectrical\nHome cleaning - from 2,500 KES",
    "Deep cleaning - from 3,500 KES\nUpholstery\nWindows - quote after visit",
  ],
  hospitality: [
    "Late checkout - ask the desk\nAirport pickup\nExtra bed - quote on request",
    "Breakfast - from 1,200 KES\nAirport pickup\nLate checkout - ask the desk",
    "Room service - until 10pm\nExtra bed\nAirport pickup - quote on request",
    "Dinner - from 2,000 KES\nLate checkout\nAirport pickup - quote on request",
  ],
  general: [
    "Consultation - quote on request\nSite visit",
    "Follow-up - included\nSite visit",
    "Call-out - quote on request\nFollow-up",
    "Desk visit - quote on request\nFollow-up",
  ],
} as const;

export type PlaceholderPools = Record<string, readonly string[]>;

export function placeholderPool(
  table: PlaceholderPools,
  vertical: string
): readonly string[] {
  return table[vertical] ?? table.general;
}

/** One member of the pool. Call once per mount. */
export function pickFromPool(pool: readonly string[]): string {
  if (pool.length === 0) return "";
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? pool[0];
}
