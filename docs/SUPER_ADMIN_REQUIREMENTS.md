# Scalers — Super Admin Requirements

## Goal

Replace the narrow “DID pool” ops page with a **Super Admin** control center for Scalers operators. Business owners keep their normal desk (`/calls`, `/settings`). Super Admin manages the platform: businesses, numbers, health, and teardown/reassignment.

**Product language:** always say **business** in the UI (never “tenant”).

---

## Access control

| Role | Who | Access |
| --- | --- | --- |
| Super Admin (ops) | Legacy login `admin@scalers.local` + `DASHBOARD_PASSWORD` | `/admin/*` |
| Business owner | Supabase Auth signup/login | Own `/calls` + `/settings` only |

Requirements:
- Super Admin routes must reject business-owner sessions (redirect to `/calls`).
- All admin mutations use the service-role server client (never expose service key to the browser).
- Destructive actions require an explicit confirmation step.

---

## Information architecture

```
/admin                 Overview (platform health)
/admin/businesses      All businesses + actions
/admin/numbers         Number pool (add / assign / release)
```

Nav label for ops: **Admin** (not “DID pool”).

Business-owner nav stays: Calls · Business · Sign out.

---

## Module requirements

### 1. Overview (`/admin`)
- KPI cards: total businesses, active businesses, businesses waiting for a number, available DIDs, assigned DIDs, calls (last 7 days).
- Short “Needs attention” list: businesses with `pending:` DID or inactive flag.
- Primary CTAs: Add number · View businesses.

### 2. Businesses (`/admin/businesses`)
- Table: Business name · Phone DID · Notify number · Status (Active / Waiting for number / Archived) · Created · Actions.
- Actions per row:
  - **Assign number** (next available or pick from pool) when waiting.
  - **Release number** (DID returns to pool as available; business goes to Waiting).
  - **Remove business** (destructive): release DID if any, delete memberships, delete that business’s calls/transcripts, delete business row. Auth users are not deleted in v1.
- Empty / loading / error states with clear copy.
- Search by business name or DID (v1 can be client filter).

### 3. Numbers (`/admin/numbers`)
- Add DID to pool (E.164 + notes).
- Pool table: Number · Status (Available / Assigned / Disabled) · Business · Notes.
- Assign next available → selected business waiting for a number.
- Prevent double-assign (DB uniqueness + status gates — already in Phase C SQL).
- Copy must say **business**, not tenant.

### 4. Platform teardown / demo reset (one-time ops)
- Ability to **remove Jirani Home Services** completely and leave `+254709221536` as **Available** in the pool for the next business.
- Documented SQL + in-UI action with typed confirmation (`REMOVE`).

---

## Data & integrity rules

1. One E.164 → at most one business (`sautikit_did_pool.e164` unique, `tenant_id` unique).
2. Only `available` numbers can be newly assigned.
3. Releasing a number sets pool row to `available`, clears `tenant_id`, and sets business DID to `pending:<business_id>` (or equivalent) until reassigned.
4. Voice engine ignores `pending:` placeholders when routing.
5. Removing a business must not leave orphan pool rows pointing at a deleted id.

---

## UX / UI principles (Super Admin)

- One purpose per section; clear page titles and one-line descriptions.
- Use **Business** everywhere in labels, filters, and empty states.
- Dense but scannable tables; status as quiet pills (not loud badges).
- Destructive actions: warn color + confirm; never one-click delete.
- Prefer the Scalers visual system (cool surfaces, ribbon blue accent, Sora/DM Sans) for consistency with the owner desk. Improve hierarchy/spacing; don’t invent a second brand.
- Mobile: tables may scroll horizontally; forms stack cleanly.

---

## Out of scope (later)

- Full RLS for owner JWT reads (Phase B).
- M-Pesa / Paystack wallet top-up (one KES wallet + ledger already shipped).
- Prompt wizard / onboarding questionnaire.
- Dynamic SautiKit DID purchase API.
- Multi-user roles inside a business (admin/member invites).
- Google OAuth for Super Admin (keep shared ops password until SSO).

---

## Success criteria

- [ ] Ops can open `/admin` and see accurate platform KPIs.
- [ ] Ops can list every business and see who is waiting for a number.
- [ ] Ops can add a DID, assign it to a waiting business, and release it back to Available.
- [ ] Jirani can be removed; `+254709221536` shows as Available and can be assigned to a new business.
- [ ] Business-owner login never sees Admin nav or `/admin` data.
- [ ] UI copy says Business, not Tenant.
