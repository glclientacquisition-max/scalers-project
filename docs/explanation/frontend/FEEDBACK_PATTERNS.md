---
owner: desk
last_reviewed: 2026-10-30
---

# Feedback patterns

How Desk, Super Admin, onboarding, and the marketing landing should show work, progress, finish, undo, and save.

**Law:** [`FRONTEND_2_0_CHARTER.md`](FRONTEND_2_0_CHARTER.md) wins. Tokens and kit: [`MASTER.md`](../../reference/design-system/MASTER.md). Motion: [`.cursor/skills/desk-motion/SKILL.md`](../../../.cursor/skills/desk-motion/SKILL.md). This file is the inventory and the copy rules. It does not add a component.

Inventory date: 2026-10-30, branch `staging/v2-c0-opening-2026-10-21`.

---

## Sources

| Pattern | What to apply | Source |
| --- | --- | --- |
| Doherty threshold | Under about 400ms, a pending spinner on the control is enough. Past that, show what is happening. | [Laws of UX: Doherty threshold](https://lawsofux.com/doherty-threshold/) (Doherty & Thadani, IBM Systems Journal, 1982). Nielsen's 0.1s / 1s / 10s limits: [Response times](https://www.nngroup.com/articles/response-times-3-important-limits/). |
| Labour illusion | Name the real steps. Tick a step only when that step has finished. A timer that advances copy is a lie. | Buell & Norton, "The Labor Illusion," *Management Science* 57(9), 2011. [doi:10.1287/mnsc.1110.1376](https://doi.org/10.1287/mnsc.1110.1376). [HBS summary](https://www.hbs.edu/faculty/Pages/item.aspx?num=40158). Progress UI: [NN/g progress indicators](https://www.nngroup.com/articles/progress-indicators/). |
| Goal-gradient | The bar and the "N of M" count move when work is done. | Kivetz, Urminsky & Zheng, "The Goal-Gradient Hypothesis Resurrected," *Journal of Marketing Research* 43(1), 2006. [doi:10.1509/jmkr.43.1.39](https://doi.org/10.1509/jmkr.43.1.39). |
| Endowed progress | A checklist may open as "1 of 5 ready" only after the first item is actually done. | Nunes & Drèze, "The Endowed Progress Effect," *Journal of Consumer Research* 32(4), 2006. [doi:10.1086/504136](https://doi.org/10.1086/504136). |
| Peak-end | The last screen is calm, names a real count, and then stops. | Kahneman, Fredrickson, Schreiber & Redelmeier, "When More Pain Is Preferred to Less," *Psychological Science* 4(6), 1993. [doi:10.1111/j.1467-9280.1993.tb00589.x](https://doi.org/10.1111/j.1467-9280.1993.tb00589.x). [Laws of UX: peak-end rule](https://lawsofux.com/peak-end-rule/). |
| Undo over confirm | Reversible actions offer Undo with the time left. Irreversible actions still confirm. | [NN/g: confirmation dialogs](https://www.nngroup.com/articles/confirmation-dialog/). [User control and freedom](https://www.nngroup.com/articles/user-control-and-freedom/). [Visibility of system status](https://www.nngroup.com/articles/visibility-system-status/). |
| Reduced motion | Finish states and bars respect `prefers-reduced-motion`. | [MDN `prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion). |

---

## Rules

1. **Wait under ~400ms:** `Button` `pending` (spinner on the control). No extra copy.
2. **Wait over ~400ms:** a short list of steps. A step shows a check only after that step's request has returned. No `setInterval` that marks work done.
3. **Progress is earned.** `role="progressbar"` with `aria-valuenow` equal to finished work. "2 of 6 ready" means two are saved.
4. **The end is a sentence with a number.** "Your shop is ready. 12 items added." Then a single next action. No confetti, no count-up, no "Nice".
5. **Undo when the write can be reversed.** The bar names what happened and the time left, and the clock matches the server window. Confirm stays for release, delete, void, charge, discard, and typed-name transfers.
6. **Save appears when the draft differs from what is stored.** While it runs: "Saving". After it lands: "Saved", plus what changed if the owner needs to know. If the server no-ops: "Nothing changed." Failure: "Couldn't save. Nothing changed."

---

## Copy

English on the screen. Keep it short enough that the same line in Kiswahili still fits a phone row (Swahili often runs longer). Buttons ≤ 22 English characters. Status ≤ 70. Finish headline ≤ 40. Sentence case. No em dashes, no exclamation marks. Nouns the owner already uses: shop, list, items, calls, number.

| Job | English | Length check (Kiswahili) |
| --- | --- | --- |
| Long wait, step | Preparing your shop | Inaandaa duka lako |
| Step, done for real | Saving your answers | Inahifadhi majibu yako |
| Step, done for real | Reading the photo | Inasoma picha |
| Checklist | 1 of 5 ready | 1 kati ya 5 tayari |
| Finish | Your shop is ready. 12 items added. | Duka liko tayari. Vitu 12 vimeongezwa. |
| Undo | Undo import | Tendua uingizaji |
| Undo time | Undo is open for 9 more minutes. | Unaweza kutendua kwa dakika 9. |
| Save idle, dirty | Save | Hifadhi |
| Save running | Saving | Inahifadhi |
| Save landed | Saved. On calls within a minute. | Imehifadhiwa. Kwenye simu ndani ya dakika moja. |
| No-op | Nothing changed. | Hakuna kilichobadilika. |
| Fail | Couldn't save. Nothing changed. | Haijahifadhiwa. Hakuna kilichobadilika. |

Cut filler that could sit on any product: "Nice", "All set", "You're all done", "Just a moment", "Hang tight".

---

## Components

The shadcn skill is a pattern guide. Charter §4.4: no shadcn runtime, no Radix, no Sonner, no second Progress package. Compose with the kit in `dashboard/src/components/ui/`.

| Job | Use | Leave out |
| --- | --- | --- |
| Pending control | `Button` `pending`, or `pendingSpinnerClass` | A page spinner for a button wait |
| Real steps | An `<ol>`. Current row: spinner. Done row: check. `aria-current="step"` | A library `Progress` that fills on a timer |
| Earned bar | The Assistant say bar: `role="progressbar"`, `h-1`, `bg-accent`, `motion-reduce:transition-none` (`AssistantSayPanel.tsx`) | Width animation as the only feedback |
| Undo | `DeskNotice` for a few seconds (`InboxArchiveToast`). `ImportUndoBar` for a long window | A second toast, a confirm before a reversible archive |
| Irreversible | `ConfirmSheet` (desk). `OpsConfirm` (admin: light / money / destructive) | Undo copy on a release or a void |
| Save | `useFormSave` + `useFormDraft`. Show `TenantSettingsSaveButton` only while `dirty`, `pending`, or `justSaved` | A Save that stays up on a clean form |
| Empty | `Empty`: title, one line, one action | "Nothing in this view." with no next step |
| Route load | `loading.tsx` + `Skeleton`, same shape as the page | A spinner in place of the list |
| Finish | Static `text-title` / `text-display` and `tabular-nums` | Confetti, Lottie, count-up |

---

## Motion

Desk stays on the five verbs: pending, live, land, shift, press. Under 300ms, `--ease-out`. Finish copy does not move. The checklist check is a static icon. The thin bar may ease its width for 300ms and must snap when `prefers-reduced-motion` is set (`motion-reduce:transition-none`, and the global kill in `globals.css`). `usePrefersReducedMotion` gates any new presence.

Marketing may keep `.landing-rise` and `.landing-drift`. Those classes stay off the desk, onboarding finish, and admin.

No confetti. No number count-up. No fake delay to "feel" longer.

---

## Inventory

Fit: **keeps** the pattern, **partial** (one piece missing), **gap** (the pattern should be here and is not).

### Save

| Surface | Files | Pattern | Fit |
| --- | --- | --- | --- |
| Shared save | `components/useFormSave.ts`, `lib/formSave.ts`, `components/TenantSettingsSaveButton.tsx` | Save when dirty; "Saving" / "Saved" | Partial. The hook tracks `dirty` and `justSaved`. The button does not hide itself. |
| Identity, greeting, hours JSON | `components/identity/IdentitySettings.tsx` | Save only when dirty | Keeps. `showSave` is dirty, pending, or just saved. |
| Alerts | `components/AlertsPanel.tsx`, `app/(desk)/settings/alertsActions.ts` | Save only when dirty | Gap. Save stays in the header on a clean form. |
| Legacy settings form | `components/TenantForm.tsx`, `app/(desk)/settings/actions.ts` (`saveAndCompileSettings`) | Save only when dirty | Gap. Save stays except on Pronunciation, which says "Changes save as you go". |
| Catalogue item | `components/catalogue/CatalogueScreen.tsx`, `lib/catalogueView.ts` (`draftDirty`, `savedLine`), `app/(desk)/settings/knowledge/actions.ts` (`saveKbItemAction`) | Save only when dirty; plain status | Keeps. Button disabled until dirty. "Nothing changed." / "Saved. On calls within a minute." |
| Policies cards | `components/policies/PoliciesSettings.tsx`, `policiesKit.tsx` (`SaveStatus`), `policiesSheets.tsx`, `app/(desk)/settings/policiesCardActions.ts` | Undo after save | Partial. Undo for 8s (`SAVED_FOR_MS`). No time left on screen. |
| When unsure | `PoliciesSettings.tsx` `saveUnsure`, `assistantSay/AssistantSayTopicSheet.tsx`, `AssistantSayFallbackEditor.tsx`, `assistantSayActions.ts` | Save when dirty | Partial. Topic sheet disables Save until dirty and says "Saved". Fallback editor always shows Save. |
| Assistant say progress | `components/assistantSay/AssistantSayPanel.tsx` | Goal-gradient | Keeps. `readyCount of total ready` from real rows. |
| Areas | `app/(desk)/settings/areas/actions.ts`, onboarding `OnboardingAreasPanel` | Save | Partial. Areas save on their own inside setup. No dirty gate documented on the control. |
| Overview payments, prices, hours | `app/(desk)/settings/overviewActions.ts` | Save | Partial. Server saves. UI status is per editor, not the shared dirty button. |
| Found facts (FAQ, address) | `settings/knowledge/foundFactsActions.ts`, `KnowledgeCatalogue.tsx` `saveFoundFact` | Save per card | Partial. Each card saves. No shared "Saved" sentence with a count. |
| Call facts correction | `components/structured/CallFactsCorrection.tsx` | Save when dirty | Keeps. Disabled until dirty and ready. |
| Insights answer | `components/insights/CallInsights.tsx` | Save | Partial. Button disabled until both fields have text. Always visible. |
| Contact name, notes, add | `ContactNameForm.tsx`, `ContactNotesForm.tsx`, `AddContactPanel.tsx` | Save | Partial. Own save handlers. No shared dirty hide. |
| On-demand usage | `components/OnDemandUsagePanel.tsx`, `app/(desk)/wallet/actions.ts` | Save | Partial. Sheet confirm for a money switch. Pending on the button. |
| People / members | `components/MembersPanel.tsx` | Confirm on remove / transfer | Keeps for destructive. Transfer types the name. |
| Plan change | `components/plan/PlanPicker.tsx` | Confirm | Keeps. Own confirm sheet. Seat button disabled when the count matches. |
| Signup, create workspace, forgot password, invite | `app/signup/SignupForm.tsx`, `RequestAccessForm.tsx`, `onboarding/CreateWorkspaceForm.tsx`, `forgot-password/ForgotPasswordForm.tsx`, `invite/[token]/InviteForms.tsx` | Pending on submit | Keeps for short waits. "Creating account…" is one line, which is right if the request stays under a few seconds. |
| Admin packages draft | `components/admin/v2/AdminPackagesV2.tsx`, `AdminPackageVersionsPanel.tsx` | Save + confirm publish | Partial. "Save draft" stays visible. Publish, discard, move, billing, and signup confirm. |
| Admin settings, voices, payments, ops people, recordings, shop money, access-request note | `AdminSettingsHubV2.tsx`, `AdminVoicesManager.tsx`, `AdminPaymentsStatus.tsx`, `AdminPlatformOpsForm.tsx`, `AdminShopMoneyPanel.tsx`, `app/admin/(console)/access-requests/actions.ts`, `lib/platformOps.ts`, `lib/recordingRetentionAdmin.ts`, `lib/packageCatalog.ts` | Save; confirm money and purge | Partial. Failures often say "Nothing changed." Save is not hidden when clean. |
| Admin security unlock | `components/admin/v2/AdminSecurityV2.tsx`, `components/ops/StepUpSheet.tsx` | Confirm | Keeps. Destructive reset types the operator. |
| Billing API copy | `app/api/admin/billing/route.ts`, `lib/adminBillingCopy.ts` | Plain failure | Keeps. "That didn't save. Nothing changed." |

### Import and other long waits

| Surface | Files | What the owner sees | Fit |
| --- | --- | --- | --- |
| Catalogue Add many | `CatalogueScreen.tsx` (`PasteSheet`), `settings/knowledge/actions.ts`, `addManyActions.ts`, `kbImportRuns.server.ts`, `lib/importUndo.ts` | Preview, then one batch. Photo: "Reading the photo…". Website: button pending only. | Partial. Labour illusion on photo is one honest line. Website and file pick have no step list. Paste preview is the right gate before the write. |
| Import undo, 10 min | `ImportUndoBar.tsx`, `kb_undo_import` via `undoImportRun` | "Undo is open for N more minutes." Clock every 15s. SQL enforces the same 10 minutes. | Keeps. Closest match to the undo rule. Summary still starts "Nice, your list is updated." |
| Import finish | `CatalogueScreen.tsx` around the paste save | "Added 12, updated 3." then the undo bar | Partial. Counts are real. "Nice," is filler. |
| Found-fact cards inside Add many | `lib/importFactDiff.ts`, `lib/factCards.ts`, `foundFacts.server.ts` | Now vs Found, each card saves alone | Partial. No single finish count for facts saved. |
| Contact CSV / phone book | `app/(desk)/contacts/import/page.tsx`, `ContactImportForm.tsx`, `app/(desk)/contacts/actions` | "Checking" then "N will be created…" then redirect to `/contacts` | Gap. Preview counts are real. No finish sentence, no undo, no step list if the apply is slow. |
| KB compile | `CatalogueScreen.tsx` compile button, `lib/kb.server.ts` `pingKbCompile`, `KbPendingNote.tsx`, `KB_PENDING_LINE` in `lib/kbCaller.ts` | "Checking now. This takes a few seconds." Then "Your latest changes reach calls in a moment." | Partial. Honest, one line. No fake steps. A wait past a few seconds still has no step list. |
| Pronunciation scan | `PronunciationCoach.tsx` | "Scanning…" plus spinner | Gap for a long scan. Pending only. Remove still confirms. |
| Setup finish | `onboarding/SetupFlow.tsx` `FinishingScreen` | "Saving your answers", "Writing your Business Assistant's script", "Getting your phone number" advance every 900ms | Gap. The last stage waits for the redirect. The earlier checks are a timer (`setInterval` 900). This is the labour-illusion miss. |
| Setup steps | `lib/setupFlow.ts` `SETUP_STEPS`, `SetupFlow.tsx` progress bar | "1 of 6" and a bar at `(index + 1) / 6` while the step is still open | Partial. Goal-gradient UI exists. The open step counts as progress before it is saved. |
| Legacy wizard | `onboarding/OnboardingWizard.tsx`, used when the setup migration is absent (`onboarding/page.tsx`) | Numbered steps, 160ms crossfade, `useFormSave` with no success toast | Partial. Steps are real. No finish counts. The fade is extra motion. |
| Line screen (peak-end) | `onboarding/line/LineView.tsx` | "{Shop} is set up" plus the number, or a pending number | Partial. Calm, no confetti. No count of items, hours, or questions saved. |
| Call setup after the number | `onboarding/line/callSetupActions.ts` `saveCallSetupAction` | Saved from the line screen | Partial. No separate finish line. |
| Marketing landing | `components/marketing/LandingPage.tsx`, `LandingStory.tsx` | Hero and sign-up links. No save, import, or progress | Keeps. Nothing here should grow a progress theatre. `.landing-rise` / `.landing-drift` stay on this page only. |
| Signup request access | `signup/RequestAccessForm.tsx`, `ResendLink.tsx` | Spinner, then "Sent" | Keeps for a short post. |

### Destructive (confirm stays)

| Action | Files | Why confirm |
| --- | --- | --- |
| Release a number | `DidPoolManager.tsx`, `AdminShopPanel.tsx`, `AdminNumbersV2.tsx`, copy in `lib/ops/stepUpCore.ts` | Cannot be undone. The number may go to someone else. |
| Remove place, starter text, catalogue row, voice, member | `PlacesEditor.tsx`, `TenantForm.tsx`, `CatalogueScreen.tsx` (row remove has Undo in the notice), `PronunciationCoach.tsx`, `AdminVoicesManager.tsx`, `AdminShopPeople.tsx`, `MembersPanel.tsx` | Delete. Catalogue row remove already undoes from the notice. The confirm before that remove is the extra step to cut if undo is reliable. |
| Discard settings / draft | `SettingsLeaveGuard.tsx` "Discard changes?", `AdminPackageVersionsPanel.tsx` "Discard this draft" | Leaving or dropping unsaved work. |
| Void invoice, credit note, start charging, live payments, recordings purge | `AdminInvoicesV2.tsx`, `AdminShopMoneyPanel.tsx`, `AdminPlatformOpsForm.tsx` | Money or data loss. |
| Publish package, move a business, signup flag, lifecycle | `AdminPackageVersionsPanel.tsx`, `AdminShopPanel.tsx`, `AdminPackagesV2.tsx` | Goes live for customers. Reason required. |
| Buy a number, resolve a checkout | `BuyNumberPanel.tsx`, `CheckoutReviewResolve.tsx` | Spend or a ledger decision. |
| Admin authenticator reset, backup codes, unlock areas | `AdminSecurityV2.tsx` | Security. Destructive ones type a name or require a reason. |
| Archive a call | `InboxArchiveToast.tsx`, `lib/inboxArchiveUndo.ts` (`INBOX_ARCHIVE_UNDO_MS` = 5s), `InboxRowOverflow.tsx`, `InboxRowSelect.tsx`, `calls/archiveActions.ts` | Undo exists, so this should not also confirm. The toast has Undo and no seconds left. It dismisses on a silent 5s timer. |

`ConfirmSheet`: `components/ui/ConfirmSheet.tsx`. Admin: `components/ops/OpsConfirm.tsx` (light, money, destructive).

### Empty and loading

Route `loading.tsx` is a shaped skeleton (charter: no route spinner). Present for desk home, calls, contacts, requests, appointments, wallet, settings (including areas, knowledge, billing, plan) and the admin console list (billing, businesses, numbers, packages, platform, quality, settings, voices, wallets, activity) plus `pay/[token]` and `pay/return/[id]`.

Missing `loading.tsx`: `/`, `/login`, `/signup`, `/onboarding`, `/forgot-password`, `/invite/[token]`. Those are short pages. A skeleton is only owed if the route suspends on data.

| Empty | File | Next action | Fit |
| --- | --- | --- | --- |
| Kit | `components/ui/Empty.tsx` | Optional `action` | The primitive allows a title with no action. Callers must pass one. |
| Contacts | `app/(desk)/contacts/page.tsx` | Clear, Show all, or Import | Keeps. |
| Inbox piles | `components/InboxPileBoard.tsx` | Per-pile empty | Keeps when the empty names the next verb. |
| Catalogue | `CatalogueScreen.tsx` | Add | Keeps. |
| Invoices (owner) | `components/plan/OwnerInvoiceList.tsx` | Line only: "They show here when one is issued." | Partial. No action, and none is honest (the owner cannot issue). |
| Admin v2 lists | `components/ops/States.tsx` `EmptyState`; `AdminInvoicesV2.tsx`, `AdminNumbersV2.tsx`, `AdminPaymentsV2.tsx`, `AdminBusinessesV2.tsx`, `AdminPackagesV2.tsx`, `AdminVoicesV2.tsx`, `AdminBillingHomeV2.tsx`, `AdminAuditV2.tsx`, `AdminAttentionV2.tsx`, `AdminInsightsV2.tsx`, `AdminQualityV2.tsx`, `AdminUsageV2.tsx` | Often title only ("Nothing in this view.", "No packages yet.") | Gap where the operator can add or clear a filter and the empty does not say so. |
| Admin shop / pool / quality | `AdminShopPanel.tsx`, `DidPoolManager.tsx`, `AdminBusinessesPanel.tsx`, `QualityEmpty.tsx`, `BuyNumberPanel.tsx` | "Add a number, then assign." / "None to buy." | Partial. Some name the next step. "None to buy." has no action because the pool is empty. |
| Beta invoices | `components/plan/BetaPlanSummary.tsx` `BetaInvoicesEmpty` | "Invoices show here once beta ends." No button. | Keeps. The owner cannot issue one during beta. |
| Onboarding catalogue | `components/OnboardingCapture.tsx` | "Add a row, tap a suggestion, or upload a list." The suggestions sit above the empty. | Partial. The next action is named. It is not a button. |
| Load error | `DeskLoadError`, `DeskError`, `DeskCrash` | Retry | Keeps. |
| Offline | `DeskOffline` | "No connection." | Keeps. |

### Checklists already counting real work

| Surface | File | Count |
| --- | --- | --- |
| Overview "Get ready for calls" | `components/HomeGetReadyCallsCard.tsx` | `{readyCount} of {total} ready` from `item.complete`. Hides when all are done. |
| Assistant say | `AssistantSayPanel.tsx` | `{readyCount} of {total} ready` plus the bar. |
| Setup header | `SetupFlow.tsx` | `{index + 1} of {SETUP_STEPS.length}` including the open step. |

Endowed progress to copy: after the first setup step is saved, the header may read "1 of 6 ready" and stay there until the next save. On arrival the count stays "0 of 6 ready".

`UsageBar` (`components/plan/UsageBar.tsx`) is a meter of minutes, seats, or credits already used (`role="meter"`). It is usage, not a setup checklist. Leave it.

---

## Follow-up PRs

Small, one surface each. Desk lane unless noted. No product change in this doc.

| Order | PR | Why first |
| --- | --- | --- |
| 1 | Setup finish ticks on real completion. `FinishingScreen` checks off "Saving your answers" when `saveSetupStepAction` returns, "Writing your Business Assistant's script" when compile returns, "Getting your phone number" when the line payload is in hand. Drop the 900ms interval. | The only place that marks work done on a timer. |
| 2 | Line screen peak-end. `LineView` adds one sentence from the saved draft: item count, and hours or questions if they were saved. No motion. | The end of setup is the peak. It currently omits the count. |
| 3 | Cut "Nice," on the catalogue import summary. Keep "Added 12, updated 3." The undo bar stays. | Copy only, on the pattern that already works (`kb_import_runs`). |
| 4 | Hide Save until dirty on Alerts and `TenantForm`, same as Identity (`showSave`). | Save-only-when-changed is already built in `useFormDraft`. |
| 5 | Inbox archive toast shows the seconds left (5s window in `INBOX_ARCHIVE_UNDO_MS`). | Undo exists. The clock is silent. |
| 6 | Contact import finish. After apply, one line with the created count, then `/contacts`. Undo only if a server undo is added in that same PR. | Preview counts die on redirect. |
| 7 | Photo, website, and pronunciation scan. One status line immediately; a second line only when the server reports a real stage. Website today has neither. | These waits cross 400ms on a slow phone. |
| 8 | Setup bar counts saved steps. "1 of 6 ready" after business is stored, not while step 1 is still open. | Goal-gradient on a true numerator. |
| 9 | Admin `EmptyState` calls that can add or clear a filter get one action. Titles that are true ("Nobody owes anything.") stay title-only. | Charter empty rule. Ops lane for any new admin verb. |
