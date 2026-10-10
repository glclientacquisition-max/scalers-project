/**
 * Team roles and the desk permission matrix (docs: /workspace/scalers-invites-design.md).
 * Pure module: no IO, safe for client and server.
 */
export const ROLES = ["owner", "admin", "staff", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  "overview.view",
  "inbox.view",
  "inbox.act", // call back, WhatsApp, SMS, mark done, archive, notes, triage
  "contacts.view",
  "contacts.edit",
  "contacts.import",
  "usage.view",
  "billing.manage", // top up, change package, on-demand usage
  "settings.view",
  "settings.edit",
  "members.view",
  "members.invite",
  "members.manage", // change role, remove (non-owner targets)
  "ownership.transfer",
] as const;
export type Action = (typeof ACTIONS)[number];

const MATRIX: Record<Role, ReadonlySet<Action>> = {
  owner: new Set(ACTIONS),
  admin: new Set<Action>(ACTIONS.filter((a) => a !== "ownership.transfer")),
  staff: new Set<Action>([
    "overview.view",
    "inbox.view",
    "inbox.act",
    "contacts.view",
    "contacts.edit",
  ]),
  viewer: new Set<Action>(["overview.view", "inbox.view", "contacts.view", "settings.view"]),
};

export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false;
  return MATRIX[role]?.has(action) ?? false;
}

/** DB role -> app role. Legacy 'member' rows map to staff. Unknown -> viewer (least privilege). */
export function normalizeRole(raw: unknown): Role {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "member") return "staff";
  return (ROLES as readonly string[]).includes(v) ? (v as Role) : "viewer";
}

/** Roles an actor may grant/change/remove. Owner is never assignable here (use transfer). */
export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["admin", "staff", "viewer"];
  if (actor === "admin") return ["staff", "viewer"];
  return [];
}

export function canManageMember(actor: Role, target: Role): boolean {
  if (target === "owner") return false;
  return assignableRoles(actor).includes(target);
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
  viewer: "View only",
};

export const ROLE_BLURBS: Record<Role, string> = {
  owner: "Everything, including transferring the business.",
  admin: "Everything except transferring ownership. Can top up and change package.",
  staff: "Inbox and contacts. No usage, billing or settings.",
  viewer: "Can look, can't change anything.",
};

/** Desk destinations and the permission needed to see them. */
export const DESK_PAGE_ACTION: Record<string, Action> = {
  "/home": "overview.view",
  "/calls": "inbox.view",
  "/contacts": "contacts.view",
  "/wallet": "usage.view",
  "/settings": "settings.view",
};

/** Hrefs to hide from the desk rail / tab bar for this role. */
export function hiddenDeskHrefs(role: Role | null): string[] {
  if (!role) return [];
  return Object.entries(DESK_PAGE_ACTION)
    .filter(([, action]) => !can(role, action))
    .map(([href]) => href);
}
