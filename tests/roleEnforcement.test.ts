/** Run: npx tsx --tsconfig dashboard/tsconfig.json --test tests/roleEnforcement.test.ts */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { can, deniedMessage, hiddenDeskHrefs, ROLES, type Action, type Role } from "../dashboard/src/lib/permissions.ts";

const root = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** Per-role expectation for each desk surface (mirrors scalers-roles-matrix.md). */
const SURFACES: Array<{ name: string; action: Action; allowed: Role[] }> = [
  { name: "inbox view", action: "inbox.view", allowed: ["owner", "admin", "staff", "viewer"] },
  { name: "inbox actions (done, archive, notes, SMS, ping)", action: "inbox.act", allowed: ["owner", "admin", "staff"] },
  { name: "contacts edit", action: "contacts.edit", allowed: ["owner", "admin", "staff"] },
  { name: "contacts import", action: "contacts.import", allowed: ["owner", "admin"] },
  { name: "usage / balance", action: "usage.view", allowed: ["owner", "admin"] },
  { name: "billing (top-up, package)", action: "billing.manage", allowed: ["owner", "admin"] },
  { name: "settings view", action: "settings.view", allowed: ["owner", "admin", "viewer"] },
  { name: "settings edit (catalog, FAQs, hours, alerts, pronunciation, bulletin)", action: "settings.edit", allowed: ["owner", "admin"] },
  { name: "team invite", action: "members.invite", allowed: ["owner", "admin"] },
  { name: "ownership transfer", action: "ownership.transfer", allowed: ["owner"] },
];

describe("per-role matrix", () => {
  for (const role of ROLES) {
    it(`${role}`, () => {
      for (const s of SURFACES) assert.equal(can(role, s.action), s.allowed.includes(role), `${role} × ${s.name}`);
    });
  }
  it("nav hides usage and import for staff and viewer; staff also loses settings", () => {
    assert.deepEqual(hiddenDeskHrefs("owner"), []);
    assert.deepEqual(hiddenDeskHrefs("staff").sort(), ["/contacts/import", "/settings", "/wallet"]);
    assert.deepEqual(hiddenDeskHrefs("viewer").sort(), ["/contacts/import", "/wallet"]);
  });
  it("denied copy is plain words and role-specific", () => {
    assert.match(deniedMessage("viewer"), /view-only access/);
    assert.match(deniedMessage("staff"), /Ask the owner or an admin/);
  });
});

describe("server guards return results (no throw)", () => {
  const actionsDir = "dashboard/src/app/(desk)";
  it("viewers can mark inbox items read", () => {
    const s = read(`${actionsDir}/calls/inboxTriageActions.ts`);
    for (const fn of ["inboxToggleRead", "inboxMarkSeen"]) {
      const body = s.slice(s.indexOf(`export async function ${fn}`), s.indexOf(`export async function ${fn}`) + 400);
      assert.match(body, /memberDenied\("inbox\.view"\)/, fn);
    }
    const mute = s.slice(s.indexOf("export async function inboxToggleMute"));
    assert.match(mute.slice(0, 400), /memberDenied\("inbox\.act"\)/);
  });
  it("memberDenied returns a DeniedResult and is the preferred guard", () => {
    const s = read("dashboard/src/lib/requireMember.ts");
    assert.match(s, /export async function memberDenied/);
    assert.match(s, /return \{ ok: false, error: deniedMessage\(role, action\), denied: true \}/);
  });
  it("API routes: /api/tenant needs settings.edit (403), preview needs a workspace and settings.view", () => {
    const t = read("dashboard/src/app/api/tenant/route.ts");
    assert.match(t, /memberDenied\("settings\.edit"\)/);
    assert.match(t, /status: 403/);
    const p = read("dashboard/src/app/api/pronunciation/preview/route.ts");
    assert.match(p, /currentMemberRole\(\)/);
    assert.match(p, /memberDenied\("settings\.view"\)/);
  });
  it("admin can't revoke an owner-sent Admin invite", () => {
    const m = read(`${actionsDir}/settings/membersActions.ts`);
    const body = m.slice(m.indexOf("export async function revokeInviteAction"), m.indexOf("export async function changeMemberRoleAction"));
    assert.match(body, /canManageMember\(actorRole, normalizeRole/);
    assert.match(body, /Only the owner can cancel an Admin invite/);
  });
  it("onboarding: only owner/admin can finish; others see 'not set up yet'", () => {
    assert.match(read("dashboard/src/app/onboarding/actions.ts"), /memberDenied\("settings\.edit"\)/);
    assert.match(read("dashboard/src/app/onboarding/page.tsx"), /WorkspaceNotReady/);
    assert.match(read(`${actionsDir}/layout.tsx`), /can\(role, "settings\.edit"\)[\s\S]*WorkspaceNotReady/);
  });
  it("/contacts/import has a page guard", () => {
    assert.match(read(`${actionsDir}/contacts/import/page.tsx`), /memberCan\("contacts\.import"\)/);
  });
});

describe("role-aware UI", () => {
  const gated: Record<string, string> = {
    InboxTicketActionDock: "inbox.act",
    LeadStatusToggle: "inbox.act",
    MarkLeadDoneButton: "inbox.act",
    InboxSmsDock: "inbox.act",
    CallerNoteComposer: "inbox.act",
    InboxPingTeammate: "inbox.act",
    RequestStatusToggle: "inbox.act",
    AppointmentStatusToggle: "inbox.act",
    InboxJobActions: "inbox.act",
    InboxJobEditor: "inbox.act",
    InboxHoldEditor: "inbox.act",
    ContactNotesForm: "contacts.edit",
    ContactNameForm: "contacts.edit",
    ContactFavouriteButton: "contacts.edit",
    AddContactPanel: "contacts.edit",
    ContactImportForm: "contacts.import",
    TenantForm: "settings.edit",
    AlertsPanel: "settings.edit",
    CatalogImportPanel: "settings.edit",
    KnowledgeIngestPanel: "settings.edit",
    PronunciationCoach: "settings.edit",
    DailyBulletinPanel: "settings.edit",
  };
  for (const [c, action] of Object.entries(gated)) {
    it(`${c} is disabled (with tooltip) without ${action}`, () => {
      assert.match(read(`dashboard/src/components/${c}.tsx`), new RegExp(`withRoleGate\\("${action.replace(".", "\\.")}", \\w+Inner\\)`));
    });
  }
  it("Suggest FAQs is hidden without settings.edit; Home usage card hidden without usage.view; import hidden", () => {
    assert.match(read("dashboard/src/components/CallFaqSuggestions.tsx"), /withRoleGate\("settings\.edit", CallFaqSuggestionsInner, "hide"\)/);
    assert.match(read("dashboard/src/app/(desk)/home/page.tsx"), /<RoleGate action="usage\.view" mode="hide">/);
    assert.match(read("dashboard/src/app/(desk)/contacts/page.tsx"), /<RoleGate action="contacts\.import" mode="hide">/);
    assert.match(read("dashboard/src/components/AddContactPanel.tsx"), /useCan\("contacts\.import"\)/);
  });
  it("RoleGate locks controls with the denial as tooltip; viewer banner in the desk shell", () => {
    const g = read("dashboard/src/components/DeskRole.tsx");
    assert.match(g, /<LockedRegion why=\{deniedMessage\(role, action\)\}/);
    assert.match(g, /view-only access/);
    const layout = read("dashboard/src/app/(desk)/layout.tsx");
    assert.match(layout, /<DeskRoleProvider role=\{role\}>/);
    assert.match(layout, /<ViewOnlyBanner \/>/);
  });
});

describe("DB hardening migration", () => {
  const sql = read("supabase/migrations/20261011130000_role_rls_hardening.sql");
  it("locks the DID pool", () => {
    assert.match(sql, /alter table public\.sautikit_did_pool enable row level security/);
    assert.match(sql, /revoke all on table public\.sautikit_did_pool from anon, authenticated/);
  });
  it("viewer writes blocked on tenant_field_meta and notify_sends; ledger owner/admin only", () => {
    assert.match(sql, /tenant_field_meta_write_admin_i[\s\S]*member_can_admin/);
    assert.match(sql, /before insert or update on public\.tenant_field_meta/);
    assert.match(sql, /notify_sends_write_not_viewer_i[\s\S]*member_can_write/);
    assert.match(sql, /wallet_ledger_select_admin[\s\S]*as restrictive for select[\s\S]*member_can_admin/);
  });
  it("is tightening only", () => {
    assert.doesNotMatch(sql, /drop table|drop column|truncate|delete from|disable row level/i);
  });
  it("DID pool is only used via service role in app code", () => {
    for (const f of ["dashboard/src/lib/tenant.ts", "dashboard/src/app/api/did-pool/route.ts", "dashboard/src/app/api/admin/businesses/route.ts"]) {
      const s = read(f);
      if (/assign_did_from_pool/.test(s)) assert.match(s, /getSupabaseAdmin\(\)/, f);
    }
  });
});
