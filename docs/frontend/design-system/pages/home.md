# Home (Command Center)

**Route:** `/home`  
**Job:** At 08:00 EAT, answer four chunks only.

1. **Is it working** — Line live / Number pending / Needs training. Wallet warn if KES < 200.
2. **What needs me** — New call leads, dense table. If zero: next useful action, not a marketing card.
3. **What happened** — Today’s call count and followed-up count as compact links, not a four-up dashboard.
4. **What to do next** — One primary CTA: Process pending leads, Train, or Test line.

**Data (real only):** tenant row, Nairobi-day call count, `lead_status` counts, up to 8 newest `new` leads, `assessMvpAnswerReadiness`, live bulletin.

**Do not:** fetch unused all/done/archived rows. Show Online. Nest `max-w-3xl` inside `max-w-desk`. Use stacked `TriageLeadCard` as the default (table first).
