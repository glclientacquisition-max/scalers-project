---
owner: platform
last_reviewed: 2026-10-14
---

# Getting started (first hour)

For a new human or agent on Scalers. Ten steps, in order.

1. Read [`../STATUS.md`](../STATUS.md) top to bottom. It is the only page with current state.
2. Read [`../../AGENTS.md`](../../AGENTS.md) and the `AGENTS.md` nearest the code you will touch (`src/AGENTS.md`, `dashboard/AGENTS.md`).
3. Find your lane contract in [`../reference/lanes/`](../reference/lanes/) and stay inside its owned paths.
4. Read [`../explanation/architecture/SYSTEM_ARCHITECTURE.md`](../explanation/architecture/SYSTEM_ARCHITECTURE.md) for the picture.
5. Install: `npm ci` at the root and `npm ci` in `dashboard/`. Use Node 22.
6. Run the gates: `npm run test:voice`, `npm run test:brain`, `npm run test:mvp`, then `cd dashboard && npm run lint && npm run build`.
7. Local voice needs a tunnel: [`../how-to/WEBHOOK_TUNNEL.md`](../how-to/WEBHOOK_TUNNEL.md).
8. Environments and which DID is which: [`../reference/operations/ENVIRONMENTS.md`](../reference/operations/ENVIRONMENTS.md). Never touch prod DID `+254709221536`.
9. Open one draft PR per task. Fill the PR template, including "STATUS updated?".
10. Anything that writes to prod or merges to `main` needs Alvin's explicit yes.
