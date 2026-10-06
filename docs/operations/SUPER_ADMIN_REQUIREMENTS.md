# Scalers — Super Admin Requirements

## Goal

Replace the narrow “DID pool” ops page with a **Super Admin** control center for Scalers operators. Business owners keep their normal desk (`/calls`, `/settings`). Super Admin manages the platform: businesses, numbers, health, and teardown/reassignment.

**Product language:** always say **business** in the UI (never “tenant”).

---

## Access control

| Role | Who | Access |
| --- | --- | --- |
| Super Admin (ops) | Username + access code (Better Auth). Host `admin.scalers.co.ke` when `ADMIN_HOST` is set. | `/admin/*` |
| Business owner | Supabase Auth signup/login | Own `/calls` + `/settings` only |

Requirements:
- Super Admin routes must reject business-owner sessions (redirect to `/home`).
- Ops sign in at `/admin/login` with a username and access code. Not email. Env: `ADMIN_OPERATORS` or `ADMIN_ACCESS_CODE` + `ADMIN_USERNAMES`.
- When `ADMIN_HOST=admin.scalers.co.ke`, the marketing host and the owner desk redirect `/admin` there. Owner desk is `APP_HOST=app.scalers.co.ke`. Add both hostnames on the same Vercel project.
- All admin mutations use the service-role server client (never expose service key to the browser).
- Destructive actions require an explicit confirmation step.

---

## Information architecture

```
/admin                 Overview: status strip, KPIs, needs-you queue
/admin/platform        Provider cards, infrastructure signals, ops mail
/admin/packages        Packages, on-demand rates, assign (customer billing)
/admin/wallets         Redirects to Businesses. Plan and charges live on the shop.
/admin/businesses      All businesses + actions
/admin/numbers         Number pool (add / assign / release)
/admin/voices          Voice catalog
```

Nav label for ops: **Admin** (not “DID pool”). Primary billing work starts on **Packages**. There is no Ledger tab. Plan (beta or on-demand) and charges sit on the Businesses shop. `/admin/wallets` redirects there.

Customer billing story: **packages + on-demand**. The wallet ledger is visible for ops metering and adjustments. Owner **package checkout** is not shipped.

Business-owner nav stays: Calls · Business · Sign out.

---

## Module requirements

### 1. Overview (`/admin`)
- Tabs name the screen. No page title.
- Needs you: open platform notices, shops waiting for a number, and live shops with no package. Archived shops stay off this pile. A row opens the shop or Platform escalate.
- Glance: Platform, Businesses, Numbers, Packages, and Calls (7 days). Not KPI tiles.
- Primary CTA: Add number when a shop is waiting or the pool is empty. Empty pile offers Add number or Packages, whichever is the next real job.

### 1b. Platform (`/admin/platform`)
- Line: phone, speech, reasoning as list rows (money on the right). Numbers opens `/admin/numbers`.
- People: contacts. Add person is a sheet.
- Alerts: Low money amount plus notify switches in a sheet. Open issues sit under Needs you; Done clears them. Acked items stay off this page.

### 2. Businesses (`/admin/businesses`)
- Needs you: waiting businesses. Assign is a sheet (next available or pick).
- List: one row per shop (number, package, money, stamp). Open the row for notify, package assign, ledger, release, remove. Type REMOVE to delete.
- Search by business name or number. Copy says **business**, not tenant.

### 3. Numbers (`/admin/numbers`)
- Needs you: businesses waiting. Assign is a sheet (next available or pick).
- Pool: list rows (number, business, Available or Assigned). Add, Buy, and Sync sit under the list. Buy confirms in a sheet. No vendor keys on the page.
- Prevent double-assign (DB uniqueness + status gates — already in Phase C SQL).
- Copy must say **business**, not tenant.

### 4. Packages (`/admin/packages`)
- Same username + access code as the rest of Super Admin. No second door. Tabs name the screen. No page title.
- Needs you: shops with no package. SKUs and shops are list rows. Rates, SKU edit, and assign open in sheets.
- **Customer billing path:** assign Starter / Growth / Scale (included buckets + monthly KES). On-demand rates apply past included when the business opts in on the desk.
- Edit on-demand rates (inbound/outbound as KES per minute, stored per second), WhatsApp, SMS, email, and annual discount %.
- Edit Starter / Growth / Scale included buckets and monthly KES. Annual price is monthly x 12 x (1 - discount %). Live is the landing switch.
- Assign a package and period to a business. Does not turn on charging. Set Plan on the shop.

### 5. Shop plan and charges
- On the Businesses shop: **Plan** is Beta or On-demand. **Charges** lists on-demand lines. Adjust is a confirm sheet.
- The KES ledger stays in the database for metering. It is not a nav destination or owner checkout.
- On-demand: past included debits the ledger when the business opted in. Beta: meter only, no charges.

### 6. Voices (`/admin/voices`)
- Tabs name the screen. No page title.
- Needs you: no default voice, or an empty catalog.
- List: name the desk hears, Live or Off, Default stamp. Voice id stays in the sheet.
- Add and edit open a sheet (name, voice id, Live, Default). Remove confirms. Catalog rank stays in the database.

### 7. Platform teardown / demo reset (one-time ops)
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
- Owner package checkout (M-Pesa / Paystack). Ops ledger top-up stays manual until then.
- Prompt wizard / onboarding questionnaire.
- Dynamic phone-line DID purchase API.
- Multi-user roles inside a business (admin/member invites).
- Google OAuth for Super Admin.

---

## Success criteria

- [ ] Ops can open `/admin` and see accurate platform KPIs.
- [ ] Ops can list every business and see who is waiting for a number.
- [ ] Ops can add a DID, assign it to a waiting business, and release it back to Available.
- [ ] Jirani can be removed; `+254709221536` shows as Available and can be assigned to a new business.
- [ ] Business-owner login never sees Admin nav or `/admin` data.
- [ ] UI copy says Business, not Tenant.
