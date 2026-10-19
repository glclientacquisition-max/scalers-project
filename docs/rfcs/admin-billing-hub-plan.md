---
owner: ops-billing
last_reviewed: 2026-10-19
status: proposed
---

# Admin and owner billing hub plan

Hick's Law: decision time grows with the number and complexity of choices. Billing admin is high stakes; the UI should never dump every shop and every action on one screen.

This plan rebuilds billing around **cards, progressive disclosure, and one primary job per step**. It extends merged #814 and the in-flight hub v2 branch (`cursor/admin-billing-hub-v2-37bb`).

Charter: [`FRONTEND_2_0_CHARTER.md`](../explanation/frontend/FRONTEND_2_0_CHARTER.md). Lane: [`OPS_BILLING.md`](../reference/lanes/OPS_BILLING.md).

---

## 1. Mental model (three layers)

| Layer | Admin language | Owner language | Where it lives |
| --- | --- | --- | --- |
| **Package** | SKU, period, included minutes | Plan name, renewal | Shop Money, Settings plan |
| **Commercial mode** | Beta meter only vs Charging | Usage opt-in, cap behavior | Shop Money plan row, Usage |
| **Money documents** | Invoices, receipts, pay links | Billing history, Pay | Shop Money (admin), Settings billing (owner) |

Never mix catalog editing (Packages) with per-shop actions. Catalog is a separate entry from the hub.

---

## 2. Hick's Law rules for billing UI

1. **At most four top-level modes** on `/admin/billing`: Needs you, All, Beta, Charging. One segmented control only.
2. **Needs you is card-first.** No shop list until the operator picks an exception type (or explicitly opens "All needs").
3. **One filled accent action per viewport** (#814 charter). On a shop, that is the confirm in a sheet, not a row of primary buttons.
4. **Cards carry count + noun + next verb.** Example: "3 · No package · Assign in shop Money". Not a wall of ListRows with equal weight.
5. **Search is secondary.** Show it after a queue card is selected, or on All/Beta/Charging directory views.
6. **Tables only for ledger lines** (charges, invoices). Shops stay ListRows inside a card panel.
7. **Owner desk mirrors the same layers** but hides admin-only moves (assign package, set mode, grant).

---

## 3. `/admin/billing` information architecture

### 3.1 Default landing: Needs you

```
┌─────────────────────────────────────┐
│ [Needs you] All  Beta  Charging     │  ← 4 choices max (Hick's level 1)
├─────────────────────────────────────┤
│ Commercial mix (single card)        │  ← beta vs charging bar only
├─────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ │
│ │ No pkg  │ │ Low min │ │ Exhaust │ │  ← exception cards (level 2)
│ │    3    │ │    7    │ │    2    │ │
│ └─────────┘ └─────────┘ └─────────┘ │
│        [ All needs · 12 ]           │  ← optional fourth card
├─────────────────────────────────────┤
│ (hidden until card tap)             │
│ Search…                             │
│ ListRow × n                         │  ← level 3: shops in one queue
└─────────────────────────────────────┘
```

**Progressive disclosure**

- Landing: mix card + exception cards only. No list, no search.
- Tap **No package**: highlight card, show search + sorted ListRows for that queue only.
- Tap same card again or **Clear**: collapse list (back to level 2).
- **All needs** card: show combined queue (still sorted by severity).

### 3.2 Directory modes: All, Beta, Charging

- Show **platform snapshot** (4 KPI tiles + mix) above search.
- Full ListRow directory (current behavior).
- No exception cards (Hick's: different task, different layout).

### 3.3 Row → shop Money

Every row deep-links to `/admin/businesses/{id}?money=1` with ListRow + Stamp. No intermediate billing detail route.

---

## 4. Shop Money (`AdminShopMoneyPanel`)

Card stack on the shop (already started in hub v2):

| Card / block | Contents | Actions inside sheet |
| --- | --- | --- |
| **Summary** | Package, usage bar, plan stamp, opt-in | Read-only |
| **Package** | Assign, remove | ConfirmSheet |
| **Plan and usage** | Mode, usage readout, opt-in readout | Plan sheet, grant |
| **Ledger** | Charges, history | Sheets |

Future **Invoices** card (phase 3): open/draft/overdue counts, mint pay link, open PDF. No DNS, no Bachs keys on screen.

---

## 5. Owner desk (Usage + Billing)

| Route | Job | Hick's shape |
| --- | --- | --- |
| `/wallet` | Meter and charge lines this period | Summary cards (minutes, credits) then ledger list |
| `/settings/billing` | Invoices and notices when not beta | Invoice ListRows; pay when gate allows |
| `/settings/plan` | Change plan when `DESK_PLAN_CHANGE=on` | Hidden until flag; one upgrade path |

Copy uses owner nouns only. Admin mode strings stay in Super Admin.

---

## 6. Today and cross-links

- **Today**: rows for billing exceptions mirror the same three queues (no package, low, exhausted) plus overdue invoice when phase 3 lands.
- **Packages / Catalog**: linked from hub header, not embedded in queue.
- **Businesses**: fallback empty state on Needs you.

---

## 7. Data and API (by phase)

| Phase | Backend | Admin UI |
| --- | --- | --- |
| **0** | Done (#814) | Queue, shop Money, remove package |
| **1** | None | Card-first Needs you, hub snapshot, Money summary card (#818) |
| **2** | Optional: `period_end` in overview query | Period chip on hub; rollover queue card |
| **3** | Invoice list + mint pay link (existing APIs) | Invoices card on Money; overdue on Today |
| **4** | Open invoice revenue block | Platform billing dashboard strip (read-only KES) |

No prod SQL without Alvin's GO. Staging-first for invoice behaviors.

---

## 8. Component map

| Component | Role |
| --- | --- |
| `AdminBillingListPanel` | Hub shell, segmented, mode-specific body |
| `AdminBillingNeedsCards` | Exception card grid (new) |
| `AdminBillingSnapshot` | KPI + mix (directory modes only) |
| `adminBillingHub.ts` | Sort, filters, stamp tones |
| `AdminShopMoneyPanel` | Shop card sections + sheets |
| `AdminBillingShopInvoices` | Phase 3 (new) |

---

## 9. Copy and stamps

| State | Stamp tone | Admin next verb |
| --- | --- | --- |
| No package | attention | Assign package |
| Low minutes | attention | Grant or change package |
| Exhausted | attention | Grant or opt-in check |
| OK | ok | — |
| Charging | brand | Review plan mode |

Run `/no-ai-slop` on all new strings.

---

## 10. Proof

- Playwright: `/dev/admin-billing` at 360, 390, 768, 1280 (light/dark).
- Scenarios: zero needs, one queue selected, directory search, shop Money summary visible.
- Class guards: `adminBillingCleanup.test.js`, `adminBillingHub.test.js`.

---

## 11. Delivery checklist

- [ ] Phase 1: card-first Needs you merged (#818)
- [ ] Phase 1: mark PR ready, staging desk when Stage-PR hold clears
- [ ] Phase 2: period end on overview
- [ ] Phase 3: invoices on Money + Today overdue
- [ ] Phase 4: owner Billing/Usage card parity
- [ ] Update `docs/STATUS.md` sections 3, 6, 8 on each merge

---

## 12. Out of scope

- Wallet top-up, balance, waive, ledger repair (product lock).
- Bachs live keys, DNS, env names on product UI.
- Owner plan change UI until `DESK_PLAN_CHANGE=on`.
