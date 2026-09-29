/**
 * Fixed desk examples. One line per vertical. No rotation pools.
 * Shop must not inherit food or home-services trades.
 */

export function callersHearPlaceholder(vertical: string): string {
  switch (vertical) {
    case "home_services":
      return "Fully booked today";
    case "retail":
      return "Pickup only today";
    case "hospitality":
      return "Fully booked tonight";
    default:
      return "Closed today";
  }
}

/** Paste list shape: name, then optional " - price". */
export function servicesPastePlaceholder(vertical: string): string {
  switch (vertical) {
    case "home_services":
      return "Home cleaning - from 2,500 KES\nPlumbing\nElectrical - quote after visit";
    case "hospitality":
      return "Late checkout - ask the desk\nAirport pickup\nExtra bed - quote on request";
    case "retail":
      return "Printing - from 500 KES\nBinding\nLamination - quote after count";
    default:
      return "Consultation - quote on request\nSite visit";
  }
}

export function knowledgePastePlaceholder(vertical: string): string {
  switch (vertical) {
    case "home_services":
      return "Cleaning service, Nairobi\nMon-Sun 8am-6pm\nHome cleaning from 2,500 KES\nQ: Do you cover Westlands?\nA: Yes, same day before noon.";
    case "hospitality":
      return "Lodge, Nairobi\nDaily 7am-10pm\nQ: Do you take walk-ins?\nA: Yes, until 9pm.";
    case "retail":
      return "Westlands Books, Nairobi\nMon-Sat 9am-7pm\nQ: Do you deliver in Nairobi?\nA: Yes, same day before noon.";
    default:
      return "Office, Nairobi\nMon-Fri 8am-5pm\nQ: Are you open Saturday?\nA: No. Monday to Friday.";
  }
}
