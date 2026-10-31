import type { BusinessType } from "@/lib/businessType";
import type { FallbackKind } from "@/lib/unknownAnswerByKindConstants";
import { DEFAULT_BY_KIND } from "@/lib/unknownAnswerByKindConstants";

/** Per business_type starting lines when the tenant has not saved their own. Keep src/conversation/unknownAnswerByKind.js in sync. */
export function defaultByKindForBusinessType(type: BusinessType): Record<FallbackKind, { en: string; sw: string }> {
  if (type === "home_services") {
    return {
      ...DEFAULT_BY_KIND,
      general: {
        en: "I'll check and someone will call you back to arrange it.",
        sw: "Nitaangalia na mtu atakupigia simu kupanga.",
      },
      price: {
        en: "I'll note what you need and someone will call you back with a price.",
        sw: "Nitaweka ombi lako na mtu atakupigia simu kwa bei.",
      },
      fee: {
        en: "I'll check whether we cover your area and someone will call you back.",
        sw: "Nitaangalia kama tunafikisha eneo lako na mtu atakupigia.",
      },
    };
  }
  if (type === "general") {
    return {
      ...DEFAULT_BY_KIND,
      general: {
        en: "Let me check with the team and get back to you.",
        sw: "Wacha niulize timu kisha nikujulishe.",
      },
      price: {
        en: "I'll note what you need and someone will call you back with a price.",
        sw: "Nitaweka ombi lako na mtu atakupigia simu kwa bei.",
      },
    };
  }
  return DEFAULT_BY_KIND;
}
