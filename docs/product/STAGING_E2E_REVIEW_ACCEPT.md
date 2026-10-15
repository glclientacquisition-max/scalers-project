# Staging E2E review (Done and Dusted Cleaning, 390px) — Product ACCEPT

**Date:** 2026-09-27  
**Source:** Founder-approved read-only E2E via Chief (~30 screens, 0 console errors). Screens: `/workspace/scalers-e2e/`  
**Ladder:** Desk honesty + polish only. Not Funnel. Not playbook Train packs. Nothing here cuts ahead of K1–K4 + notify hygiene.

## Verdicts

| # | Item | Call | Seat | Acceptance |
| --- | --- | --- | --- | --- |
| 1 | Transcript words glued ("Takeyour", "Iam") on `/calls/<id>` | **ACCEPT P0-a** | Builder | Segments join with correct spacing; no glued words on 3 real TEST calls; no rewrite of transcript content |
| 2 | Home vs Inbox counts disagree (91 vs Needs you 107); summary order differs from rows; "Hold Done" noun | **ACCEPT P0-b (honesty)** | Critic names nouns + formula, then Builder (Platform only if the count needs a new query) | One shared count source for Home and Inbox; summary sentence lists states in the same order as rows; "Hold Done" removed, noun from Critic vocab; if Home and Inbox count different sets, each label says exactly which set |
| 3a | "Sartuday" typo (Train, then Locations) | **KILL as code fix** | none | Owner-entered tenant data (Locations area + a pronunciation entry), not code. Owner edits it; no code or data wipe |
| 3b | FAQs "6 of 25" vs "1-5 of 6" | **ACCEPT quick fix** | Builder | Both labels read the same real totals |
| 3c | Pronunciation "Nothing left to practice" with 5 saved | **ACCEPT quick fix** | Builder | Empty-state copy only when nothing is pending; with saved items, copy says they are saved (no false "nothing") |
| 4 | Chip rows cut off without scroll hint | **ACCEPT** | Desk UX | Trailing fade + snap scroll on Inbox, Contacts, History chip rows (already in `InboxFilterPills` spec) |
| 5 | Inbox rows low-info ("Alvin · Caller called."), reason truncated, big Call/WA | **ACCEPT** | Desk UX (Builder if reason field missing) | Row shows the real reason line first; drop filler "Caller called"; Call/WA become compact icons; reason readable at 390 (2 lines max) |
| 6a | History filters use Inbox nouns (Missed / Human asked / Visits) | **KEEP — per spec** | none | `CONTACTS_PERSON_FILE_ACCEPT.md` requires History labels to map to Inbox states; Contacts *list* stays All · Saved · Unsaved |
| 6b | Unlabeled bar chart under NOTES | **KILL unless labeled + derived** | Desk UX | Remove it, or label axis/meaning from a Critic-locked derivation; no unlabeled wallpaper |
| 7 | "Out of chicken today" placeholder on cleaning tenant | **ACCEPT** | Builder | Placeholder picked by existing vertical (`home_services` vs `retail`) — no new tenant niche metadata (still DEFER) |
| 8 | "Add to Favourites" vs Saved filter | **ACCEPT Desk UX proposal (re-call 2026-09-27)** | Desk UX | In `contactsLoad.ts` Saved means the contact has a name; Favourite is a separate flag (`metadata.favourite_at`). "Save contact" = the existing name/save flow, shown only on unnamed contacts. Remove Favourite wording and toggle from the UI. Keep `favourite_at` data untouched (no migration, no delete). No new Favourites filter or pile |

## Sequence

1. P0-a transcript join + 3b–3c quick fixes (one small Builder PR; no semantics change).  
2. P0-b count truth: Critic locks nouns + formula first, then Builder.  
3. Desk UX taste pass: 4, 5, 6b, 8 in one PR.  
4. Builder: 7.  
All behind the honesty wedge in priority: if K1–K4 or notify needs Builder, it wins.

## Item 8 kill / revisit

Favourite is a soft pile next to the VIP / Lead / Cold piles already killed. If owners ask for a pinned-contacts control later, it returns as its own spec with a noun distinct from Saved.

## Out of scope

New `lead_status`, new Needs you rules, Funnel, niche metadata, playbook packs, Online/delivered language.

## Kill / rollback

Any fix that changes what counts as Needs you without Critic lock, or invents a state noun, is reverted.
