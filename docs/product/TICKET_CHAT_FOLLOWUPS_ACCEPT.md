# Ticket chat follow-ups — Product ACCEPT

**Date:** 2026-09-21  
**Status:** ACCEPT — founder follow-ups after #384 Release GO  
**Extends:** `docs/product/TICKET_CHAT_DISPLAY_ACCEPT.md` (declutter closed)  
**Ladder:** Parallel desk polish. Not Funnel. Not WA Cloud. Not Contacts. Not honesty semantics.

**Evidence (staging READY #384):** mobile-chat-nav.png · ai-generic.png · em-dash-examples.png

---

## Problem

After declutter GO, three leftover operator pains on ticket chat:
1. Mobile (~390) still shows full bottom nav (Overview · Inbox · Contacts · Usage · Profile) — same shell as list, wrong for immersive chat.
2. Owner-facing copy uses em dashes (e.g. “Very short call — little conversation”).
3. AI-generic chrome still shows: “FAQ ideas” / “Find FAQ ideas”, Ask AI noise without a shipped job.

## Operator outcome

On ticket chat: phone feels like chat (no competing tab bar), copy is plain Kenyan-SME English, no fake AI affordances.

## Acceptance (P0)

1. **Hide full bottom nav on mobile ticket chat (~390).** While on call/ticket chat route, do not show Overview·Inbox·Contacts·Usage·Profile bar. Exit/back still clear. Tablet/desktop keep existing shell unless the same chrome fights the dock.  
2. **No em dashes in owner-facing ticket copy.** Use plain hyphen or rephrase (e.g. “Very short call - little conversation” or “Very short call. Little conversation.”). Sweep ticket chat / summary / system lines in this surface.  
3. **Remove AI-generic chrome on ticket:** drop “FAQ ideas” / “Find FAQ ideas”, and any Ask AI / sparkle / “How can I help” beyond those on this surface. Do not invent a replacement AI feature. Polish on the SMS dock is a shipped tighten-draft job (`polishInboxSmsAction`), not sparkle.  
4. Dock (Mark done · WhatsApp · Call · Ping / Confirm·Hold Done) stays. Contact strip is identity only. Honesty chips unchanged (Critic if copy moves).  
5. Release smoke ~390 + tablet + desktop; confirm nav hidden on mobile ticket only.

## Out of scope

- Tenant Funnel Page, WA Cloud / Meta connect  
- Contacts list/strip redo  
- Bookings honesty K1–K4, notify ledger, lead_status invent  
- New AI assistant / FAQ product  
- Redesign of global bottom nav on non-ticket routes  

## Seat

| Who | Does |
| --- | --- |
| Desk UX | Nav hide + copy sweep + remove AI chrome + PR |
| Desk Builder | Only if route/shell handlers block nav hide |
| Critic | Only if honesty labels move |
| Release | Smoke 390 / tablet / desktop |

## Kill / rollback

If bottom nav hide breaks escape from ticket, or AI chrome returns as soft product, or honesty wording softens → revert. Prefer revert over pile-on chrome.

## Verify (TEST)

Open ticket on ~390 → no full bottom tab bar → no em dash in ticket copy → no FAQ ideas / sparkle → Polish then Send on SMS → dock still works → tablet/desktop still usable.
