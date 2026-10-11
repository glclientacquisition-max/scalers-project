// Unified capability gates. Twin of src/conversation/capabilityGates.js.
//
// Every action the Business Assistant can only take once the owner sets it up
// (holds, site visits, booked time slots, callbacks) has one gate.
// A gate is Live or Needs setup, lists what is missing with a link to the exact
// field that fixes it, and says what callers hear in each state. Requirement ids
// match the call brain, so the Overview and the phone line always agree.
//
// Holds come from tenant_hold_gate (the same RPC the call brain reads). The other
// gates are computed from the tenant row with the provenance twin.

import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { confirmedSlotEnabled, factServices, holdOrdersEnabled } from "@/lib/provenance";

export type CapabilityId = "holds" | "site_visits" | "booking_slots" | "callbacks";

export type RequirementId =
  | "holds_policy_on"
  | "holdable_item"
  | "verified_alert"
  | "owner_service"
  | "booking_mode_confirmed"
  | "callback_contact"
  | "escalate_on";

export type Requirement = {
  id: RequirementId;
  label: string;
  /** Deep link to the field that fixes it. Null when only Scalers can fix it. */
  href: string | null;
  fixLabel: string;
  done: boolean;
};

export type CapabilityGate = {
  id: CapabilityId;
  title: string;
  /** What a caller asks for this. */
  question: string;
  allowed: boolean;
  status: "live" | "needs_setup";
  requirements: Requirement[];
  missing: Requirement[];
  callerHearsLive: string;
  callerHearsLocked: string;
};

const POLICIES = businessSettingsHref("train", "policies");
const CATALOG = businessSettingsHref("catalog");
const ALERTS = businessSettingsHref("alerts");
const TEAM = businessSettingsHref("train", "team");
const TOOLS = businessSettingsHref("train", "tools");

export const REQUIREMENT_COPY: Record<RequirementId, { label: string; href: string | null; fixLabel: string }> = {
  holds_policy_on: { label: "Say you hold items for customers", href: `${POLICIES}#holds`, fixLabel: "Open Policies" },
  holdable_item: { label: "Mark at least one catalogue item as holdable", href: `${CATALOG}#holdable`, fixLabel: "Open Catalogue" },
  verified_alert: { label: "Set up WhatsApp or email alerts so you hear about each hold", href: ALERTS, fixLabel: "Open Alerts" },
  owner_service: { label: "Add at least one service you offer", href: CATALOG, fixLabel: "Open Catalogue" },
  booking_mode_confirmed: { label: "Let callers book a time slot directly", href: `${POLICIES}#bookings`, fixLabel: "Open Policies" },
  callback_contact: { label: "Add a team contact with WhatsApp or email who gets callback alerts", href: TEAM, fixLabel: "Open Team" },
  escalate_on: { label: "Allow the Business Assistant to alert you", href: TOOLS, fixLabel: "Open Voice" },
};

/** Map one tenant_hold_gate reason to a requirement id (same as the call brain). */
export function holdReasonId(reason: string): RequirementId | null {
  const text = String(reason || "").toLowerCase();
  if (/not enabled in policies/.test(text)) return "holds_policy_on";
  if (/holdable product/.test(text)) return "holdable_item";
  if (/notify target|alerts/.test(text)) return "verified_alert";
  return null;
}

function requirements(all: RequirementId[], missing: RequirementId[]): Requirement[] {
  return all.map((id) => ({ id, ...REQUIREMENT_COPY[id], done: !missing.includes(id) }));
}

function gate(
  base: Omit<CapabilityGate, "allowed" | "status" | "requirements" | "missing">,
  all: RequirementId[],
  missingIds: RequirementId[],
): CapabilityGate {
  const reqs = requirements(all, missingIds);
  const missing = reqs.filter((r) => !r.done);
  const allowed = missing.length === 0;
  return { ...base, allowed, status: allowed ? "live" : "needs_setup", requirements: reqs, missing };
}

export type GateTenant = {
  vertical?: string | null;
  product_catalog?: unknown;
  services_catalog?: unknown;
  business_policies?: unknown;
  handoff_mode?: string | null;
  team_directory?: unknown;
  agent_tools?: unknown;
};

/** A teammate who gets alerts and can be reached on WhatsApp (phone) or email. */
export function teamHasCallbackContact(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some((row) => {
    const r = (row || {}) as { phone?: unknown; email?: unknown; receives_escalation?: unknown };
    if (r.receives_escalation === false) return false;
    const phone = String(r.phone || "").replace(/[^\d]/g, "");
    const email = String(r.email || "").trim();
    return phone.length >= 9 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  });
}

function escalateOn(raw: unknown): boolean {
  return (raw as { escalate?: unknown } | null)?.escalate !== false;
}

function holdHours(policies: unknown): number | null {
  const holds = (policies as { holds?: { max_hours?: unknown } } | null)?.holds;
  const n = Number(holds?.max_hours);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * All gates for this business type. `holdGate` is the tenant_hold_gate result
 * (null when the RPC is missing: holds then read as Needs setup with the policy
 * step first, the safe default).
 */
export function capabilityGates(
  tenant: GateTenant,
  opts: { holdGate?: { allowed: boolean; reasons: string[] } | null; fieldMeta?: unknown } = {},
): CapabilityGate[] {
  const vertical = tenant.vertical === "home_services" ? "home_services" : "retail";
  const out: CapabilityGate[] = [];

  if (vertical === "retail") {
    const hg = opts.holdGate;
    let missing: RequirementId[];
    if (hg && hg.allowed) missing = [];
    else if (hg && Array.isArray(hg.reasons) && !hg.reasons.includes("provenance_rpc_missing")) {
      missing = [...new Set(hg.reasons.map(holdReasonId).filter((id): id is RequirementId => Boolean(id)))];
      if (!missing.length) missing = ["holds_policy_on"];
    } else {
      // RPC missing on this database: the call brain falls back to the catalogue +
      // hold-rule check, so the Overview does too.
      const fallback = holdOrdersEnabled({
        productCatalog: tenant.product_catalog,
        businessPolicies: tenant.business_policies,
        fieldMeta: opts.fieldMeta ?? null,
      });
      missing = fallback ? [] : ["holds_policy_on", "holdable_item"];
    }
    const hours = holdHours(tenant.business_policies);
    out.push(
      gate(
        {
          id: "holds",
          title: "Holds",
          question: "Can you hold this for me?",
          callerHearsLive: hours
            ? `"Yes, I can hold it for you for up to ${hours} hours. I'll let the owner know."`
            : `"Yes, I can hold it for you. I'll let the owner know."`,
          callerHearsLocked: `"I can't hold items, but I'll pass your request to the owner."`,
        },
        ["holds_policy_on", "holdable_item", "verified_alert"],
        missing,
      ),
    );
  } else {
    const services = factServices(tenant.services_catalog, opts.fieldMeta ?? null).length > 0;
    out.push(
      gate(
        {
          id: "site_visits",
          title: "Visit requests",
          question: "Can someone come and look at it?",
          callerHearsLive: `"I've booked a visit request. The owner will confirm the time."`,
          callerHearsLocked: `"I'll take your details and the owner will call you about a visit."`,
        },
        ["owner_service"],
        services ? [] : ["owner_service"],
      ),
    );
    const slots = confirmedSlotEnabled({ businessPolicies: tenant.business_policies, fieldMeta: opts.fieldMeta ?? null });
    out.push(
      gate(
        {
          id: "booking_slots",
          title: "Bookings",
          question: "Can you book me in for Thursday?",
          callerHearsLive: `"You're booked for Thursday at 10am."`,
          callerHearsLocked: `"I've noted Thursday. The owner will confirm the time."`,
        },
        ["booking_mode_confirmed"],
        slots ? [] : ["booking_mode_confirmed"],
      ),
    );
  }

  // Scalers does not put callers through live. The Business Assistant takes the
  // caller's name and reason, and the team is alerted by WhatsApp or email to call back.
  const callbackMissing: RequirementId[] = [];
  if (!teamHasCallbackContact(tenant.team_directory)) callbackMissing.push("callback_contact");
  if (!escalateOn(tenant.agent_tools)) callbackMissing.push("escalate_on");
  out.push(
    gate(
      {
        id: "callbacks",
        title: "Callbacks",
        question: "Can I talk to the owner?",
        callerHearsLive: `"I've taken your details. The owner will call you back."`,
        callerHearsLocked: `"I've noted your question. Please call again later."`,
      },
      ["callback_contact", "escalate_on"],
      callbackMissing,
    ),
  );
  return out;
}

export function gateStatusLabel(g: Pick<CapabilityGate, "status">): string {
  return g.status === "live" ? "Live" : "Needs setup";
}
