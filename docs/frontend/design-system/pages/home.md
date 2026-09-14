# Home (Command Center)

**Route:** `/home`  
**Job:** At 08:00 EAT, answer four chunks only.

1. **Is it working** — Line live / Number pending / Needs training. Wallet warn if KES < 200.
2. **What needs me** — Three exclusive Inbox destinations from the same assemble as Inbox: return calls (Needs you), open Holds, visits still to confirm. Confirmed visits are the Visits book, not this briefing. Caption is a briefing. When a queue is 1, the unit is the actual job.
3. **What happened** — Calls today as a compact link.
4. **What to do next** — Niche CTA into the sharpest queue.

**Chrome:** Greeting eyebrow, workspace name as `h1` (not in the app header). Nairobi `<time>`. One aside: today + line + wallet + docked CTA.

**Desktop gains a second column.** Below `lg` the page is one column: Work, then aside. At `lg` the grid is 7/5: Work (queues + Next to return) on the left, aside on the right. The aside is sticky (`top-24`). The extra width is real content, not margin.

**Next to return (desktop only, `hidden lg:block`).** The first open return call from `summarizeInboxWork.nextReturn`. Who, when (`formatCallWhenRelative`), one-line reason. Tap the card to open the conversation. Ghost WhatsApp is the only button. No Open call link.

**One blue action per screen.** The aside CTA is the only filled primary. Next to return uses a ghost WhatsApp button (green glyph). Two saturated CTAs would compete; the CTA already routes to the sharpest queue.

**Aside sections.** Today, Line, and Wallet are hairline-separated sections. Values self-label: `Line live` + DID, `KES 0` + Top up. No caps headings on self-evident data rows. Caps eyebrows introduce content regions only (greeting, Next to return). Wallet always shows the balance; `Top up` appears only when low. Line shows the formatted DID (`+254 700 000 000`).

**Row density and count weight.** Queue rows are `min-h-12` on phone, `min-h-11` at `lg`. Counts are `text-base font-semibold` so the largest queue (85 to return) holds its own against the blue CTA.

**Data (real only):** tenant row, Nairobi-day call count, `loadInboxItems` (same window as Inbox), `assessMvpAnswerReadiness`, live bulletin. Counts match Inbox purpose, not raw `lead_status=new`.

**Do not:** duplicate the Inbox table. Show Online. Use stacked `TriageLeadCard`.
