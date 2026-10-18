/** Code-level matrix: every desk server action's permission × role. Run with tsx. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { can, ROLES, type Action } from "../dashboard/src/lib/permissions.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESK = path.join(__dirname, "..", "dashboard", "src", "app", "(desk)");
function walk(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : /\.ts$/.test(e.name) ? [p] : [];
  });
}
function actionPerms(): Record<string, Action> {
  const out: Record<string, Action> = {};
  for (const f of walk(DESK)) {
    const s = fs.readFileSync(f, "utf8");
    if (!/^"use server";/m.test(s)) continue;
    const re = /export async function (\w+)\([\s\S]*?memberDenied\("([a-z.]+)"\)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[2] as Action;
  }
  return out;
}

// Expected allow-list per action (owner always allowed).
const EXPECT: Record<string, Array<"admin" | "staff" | "viewer">> = {
  revalidateLiveDesk: ["admin", "staff", "viewer"], revalidateLiveTicket: ["admin", "staff", "viewer"], revalidateLiveUsage: ["admin"],
  refreshInboxList: ["admin", "staff", "viewer"], inboxToggleRead: ["admin", "staff", "viewer"], inboxMarkSeen: ["admin", "staff", "viewer"],
  inboxToggleMute: ["admin", "staff"], inboxTogglePin: ["admin", "staff"], inboxAssignTeammate: ["admin", "staff"], inboxAddLabel: ["admin", "staff"], inboxSnooze: ["admin", "staff"],
  updateLeadStatus: ["admin", "staff"], logWhatsAppFollowUp: ["admin", "staff"], pingTeammateAction: ["admin", "staff"],
  polishCallerNoteAction: ["admin", "staff"], polishInboxSmsAction: ["admin", "staff"], sendCallerNoteAction: ["admin", "staff"], sendInboxReplySms: ["admin", "staff"],
  suggestFaqsFromCallAction: ["admin", "staff"], applyFaqSuggestionsAction: ["admin"],
  updateServiceRequestStatus: ["admin", "staff"], updateServiceRequestSchedule: ["admin", "staff"], updateAppointmentStatus: ["admin", "staff"], updateAppointmentSchedule: ["admin", "staff"],
  loadContactsSlice: ["admin", "staff", "viewer"], ensureInboxContact: ["admin", "staff"], createContact: ["admin", "staff"], updateContactNotes: ["admin", "staff"],
  updateContactName: ["admin", "staff"], updateContactFavourite: ["admin", "staff"], previewContactCsv: ["admin"], applyContactCsv: ["admin"],
  saveAndCompileSettings: ["admin"], saveAlertsAction: ["admin"], postBulletinAction: ["admin"], editBulletinAction: ["admin"], clearBulletinAction: ["admin"],
  confirmPriceAction: ["admin"], saveBusinessCategoryAction: ["admin"], correctCallFactsAction: ["admin", "staff"], addFaqFromInsightAction: ["admin"],
  previewCatalogImportAction: ["admin"], applyCatalogImportAction: ["admin"], extractKnowledgeAction: ["admin"], applyIngestAction: ["admin"],
  screenPronunciationSuggestionsAction: ["admin"], confirmPronunciationRecording: ["admin"], persistPronunciationLexicon: ["admin"], minePronunciationFromCallsAction: ["admin"], quickAddPronunciationAction: ["admin"],
  loadPronunciationReviewQueueAction: ["admin", "viewer"], geminiScanRecentCallsAction: ["admin"], approveGeminiScanCandidateAction: ["admin"], dismissGeminiScanCandidateAction: ["admin"], queueGeminiCandidateForRecordingAction: ["admin"],
  inviteMemberAction: ["admin"], resendInviteAction: ["admin"], revokeInviteAction: ["admin"], changeMemberRoleAction: ["admin"], removeMemberAction: ["admin"], transferOwnershipAction: [],
  saveOnDemandUsage: ["admin"],
  confirmPlanChange: ["admin"], confirmSeatPurchase: ["admin"], markBillingNoticeRead: ["admin"],
};

it("every guarded action is in the expected matrix (and vice versa)", () => {
  assert.deepEqual(Object.keys(actionPerms()).sort(), Object.keys(EXPECT).sort());
});

for (const role of ROLES) {
  it(`${role}: each server action allowed/denied as expected`, () => {
    const perms = actionPerms();
    for (const [fn, allowed] of Object.entries(EXPECT)) {
      const want = role === "owner" || (allowed as string[]).includes(role);
      assert.equal(can(role, perms[fn]), want, `${role} × ${fn} (${perms[fn]})`);
    }
  });
}
