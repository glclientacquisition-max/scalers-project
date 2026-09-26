# Home (Command Center)

**Route:** `/home`  
**Job:** At 08:00 EAT, answer four chunks only.

1. **Is it working** — Line live / Number pending / Needs training. Usage link if included minutes are gone (skip for beta).
2. **What needs me** — Three exclusive Inbox destinations from the same assemble as Inbox: return calls, open Holds, visits still to confirm. Row 1 uses the niche return label (`copy.returnCtaMany`), counts `toReturn`, and opens `purpose=human` (the Human pile). Inbox **Needs you** is the full open-work pile; do not reuse that label here. Confirmed visits are the Visits book, not this briefing. Caption is a briefing (`deskPreviewClass`). Visit units stay count nouns (`3 to confirm`). Open hold units use Hold Done (`3 Hold Done`), never to fulfill. Return calls let the count carry the row. When a hold or visit queue is 1, a short slot (`Tue 14:00`) may replace the unit. Never inject the hangup headline. Under it, one digest line for the receptionist's Nairobi day (`Today: 4 answered, 2 visits, 1 complaint.`). Null when nothing happened or when the call history tape is truncated (`callsTruncated`). Open holds and visits are loaded in full, so return-call counts stay complete even when the tape is truncated. Never a guess.
3. **What happened** — Calls today as a compact link.
4. **What to do next** — Niche CTA into the sharpest queue. Confirm visit or Hold Done. Hospitality Confirm booking stays gated until reservations exist.

**Chrome:** Left-aligned stack, not a centered billboard. Row 1 is a compact Scalers lockup (`BrandLockup` `size="sm"`, name Scalers, `href={null}`, not `markOnly`). Row 2 is the workspace `h1` (`text-lg font-semibold text-ink min-w-0 truncate`). Row 3 is the muted Nairobi date (`text-sm text-ink-soft` `<time>`). Phone and `md+` content column share this stack. The rail still has its own mark; do not add a second giant lockup. Not sticky, not Sign out, not the word Overview, no time-of-day greeting. One aside: today + line + remaining minutes + docked CTA.

**Live.** The desk-shell `LiveInbox` subscription re-runs this page when a work-table row lands, and `revalidatePath` keeps Home current even if the owner is on another desk route. Briefing, queues, digest, and Next to return stay current without a manual refresh.

**Desktop gains a second column.** Below `lg` the page is one column: Work, then aside. At `lg` the grid is 7/5: Work (queues + Next to return) on the left, aside on the right. The aside is sticky (`top-24`). The extra width is real content, not margin.

**Next to return.** The first open return call from `summarizeInboxWork.nextReturn`. Who, when (`formatCallWhenRelative`), one truncated reason (`deskPreviewClass`). Tap the card to open the conversation. Ghost WhatsApp is the only button. No Open call link. On phone (`lg:hidden`) it is a compact row under Work. At `lg` it is the left-column card (`hidden lg:block`).

**Updates.** Same `DailyBulletinPanel` as Profile `?tab=updates`. Callers hear, Until chips (Tonight · Tomorrow night · I clear it · Pick), Post update, Clear. Pick uses From Now / Later plus date and time fields (not `datetime-local`). One preview line states the window. Writes `daily_bulletin` `starts_at` / `ends_at` through `bulletinActions`. Callers hear a row only after start and before end (`isBulletinLive`). Scheduled rows stay on the desk list. Always on Home after Work (and Next to return when that row exists). Not a second persist path. Post update stays filled and docked to the field.

**One blue action per screen.** The aside CTA is the work primary. Next to return uses a ghost WhatsApp button (green glyph). Post update is the Updates primary, docked to Callers hear.

**Aside sections.** Today, Line, and remaining minutes are hairline-separated sections. Values self-label: `Line live` + DID, `280 min left` + pack label. No caps headings on self-evident data rows. Caps eyebrows introduce content regions only (Next to return). Minutes always show. `Usage` appears only when included minutes are gone and the workspace is not beta. Line shows the formatted DID (`+254 700 000 000`).

**Row density and count weight.** Queue rows are `min-h-12` on phone, `min-h-11` at `lg`. Counts are `text-base font-semibold` so the largest queue (85 to return) holds its own against the blue CTA.

**Data (real only):** tenant row, Nairobi-day call count, `loadCachedInboxItems` (open holds/visits unbounded, then a 150-row call tape), `assessMvpAnswerReadiness`, live bulletin. Counts match Inbox purpose, not raw `lead_status=new`.

**Do not:** duplicate the Inbox table. Show Online. Use stacked `TriageLeadCard`.
