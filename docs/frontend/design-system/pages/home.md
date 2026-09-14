# Home (Command Center)

**Route:** `/home`  
**Job:** At 08:00 EAT, answer four chunks only.

1. **Is it working** — Line live / Number pending / Needs training. Wallet warn if KES < 200.
2. **What needs me** — Three exclusive Inbox destinations from the same assemble as Inbox: return calls (Needs you), open Holds, visits still to confirm. Confirmed visits are the Visits book, not this briefing. Caption is a briefing. When a queue is 1, the unit is the actual job.
3. **What happened** — Calls today as a compact link.
4. **What to do next** — Niche CTA into the sharpest queue.

**Chrome:** Greeting eyebrow, workspace name as `h1` (not in the app header). Nairobi `<time>`. One aside: today + line + wallet + docked CTA.

**Desktop gains a second column.** Below `lg` the page is one column: Work, then aside. At `lg` the grid is 7/5: Work (queues + Next to return) on the left, aside on the right. The aside is sticky (`top-24`). The extra width is real content, not margin.

**Next to return (desktop only).** The first open return call from `summarizeInboxWork.nextReturn`. Who, when (`formatCallWhenRelative`), one-line reason. Primary action is **Reply on WhatsApp** (prefilled). Secondary is **Open call**. This is the "second column of real content" desktop earns. It does not duplicate the Inbox table.

**Aside sections.** Today, Line, and Wallet are separate `<section>`s with hairline `border-t` separators, not one blob. Wallet always shows the KES balance; `Top up` appears only when low. Line shows the formatted DID (`+254 700 000 000`).

**Row density.** Queue rows are `min-h-12` on phone, `min-h-11` at `lg`. Desktop is denser; mobile keeps touch targets.

**Data (real only):** tenant row, Nairobi-day call count, `loadInboxItems` (same window as Inbox), `assessMvpAnswerReadiness`, live bulletin. Counts match Inbox purpose, not raw `lead_status=new`.

**Do not:** duplicate the Inbox table. Show Online. Use stacked `TriageLeadCard`.
