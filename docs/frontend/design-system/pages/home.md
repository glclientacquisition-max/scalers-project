# Home `/home`

**Job:** What needs me, what happened, is the line working, one next action.  
**Visual:** Follow [`MASTER.md`](../MASTER.md). Do not invent a dashboard.

## Now (extracted)

Greeting + “Overview” title, optional live Updates strip, four `MetricCard` links, one primary “Process Pending Leads”. Extra `max-w-3xl`. Fetches then voids `all` / `done` / `archived` / 40 new leads.

## Phase 3 (compose from existing pieces)

Order:

1. **Needs me** — New call leads only. Evaluate `TriageLeadCard` vs a Calls table row. Do not mix requests/appointments until Phase 4.
2. **Happened** — Keep today’s count and followed-up count (already real). KPI tiles must keep their hrefs into `/calls` or `/wallet`.
3. **Working** — DID + `assessMvpAnswerReadiness` only. Labels: Line live, Number pending, Needs training. Never Online.
4. **Next** — One primary `#0096FF` button (existing Home CTA recipe).

Drop unused fetches. No fake metrics. No landing motion.

Empty: if no new leads, do not show a blank card stack. Show the next real action (test line, train, or caught up) using Calls empty-state language.

Updates strip may stay if `liveBulletinItems` has rows (already real).
