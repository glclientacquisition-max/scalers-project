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

export const KNOWLEDGE_PASTE_POOLS = {
  retail: [
    "Westlands Books, Nairobi\nMon-Sat 9am-7pm\nQ: Do you deliver in Nairobi?\nA: Yes, same day before noon.",
    "Print shop, Nairobi\nMon-Sat 8am-5pm\nQ: Can I pick up today?\nA: Yes, after 2pm.",
    "Stationery shop, Nairobi\nMon-Fri 8am-6pm\nQ: Do you print business cards?\nA: Yes. Ready the next day.",
    "Paper shop, Nairobi\nMon-Sat 9am-6pm\nQ: Do you deliver A4?\nA: Yes, same day in Nairobi.",
  ],
  home_services: [
    "Cleaning service, Nairobi\nMon-Sun 8am-6pm\nHome cleaning from 2,500 KES\nQ: Do you cover Westlands?\nA: Yes, same day before noon.",
    "Plumbing desk, Nairobi\nMon-Sat 8am-5pm\nCall-out from 1,500 KES\nQ: Do you cover Kilimani?\nA: Yes, same day.",
    "Sofa cleaning, Nairobi\nMon-Fri 8am-6pm\nSofa cleaning from 1,500 KES\nQ: Do you cover Karen?\nA: Yes. Book a visit.",
  ],
  hospitality: [
    "Lodge, Nairobi\nDaily 7am-10pm\nQ: Do you take walk-ins?\nA: Yes, until 9pm.",
    "Restaurant, Nairobi\nDaily 12pm-10pm\nQ: Are you fully booked tonight?\nA: Yes. Try tomorrow.",
    "Hotel, Nairobi\nFront desk all night\nQ: Is breakfast included?\nA: Yes, from 7am.",
  ],
  general: [
    "Office, Nairobi\nMon-Fri 8am-5pm\nQ: Are you open Saturday?\nA: No. Monday to Friday.",
    "Studio, Nairobi\nMon-Fri 9am-4pm\nQ: Can I call tomorrow?\nA: Yes, from 9am.",
    "Desk, Nairobi\nMon-Thu 8am-5pm\nQ: Are you closed Friday?\nA: Yes. Back Monday.",
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
