# Super Admin ops workflows — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Ship workflow-first Super Admin: shop detail route, unified waiting rules, Quality nav label, Today volume clarity, then auth hardening and search.

**Architecture:** Desk presentation + thin read models; mutations unchanged on `/api/admin/*`. Platform owns auth slice.

**Tech Stack:** Next.js App Router, existing admin libs, UI kit (`ListRow`, `Sheet`, `ConfirmSheet`).

**Spec:** [`docs/superpowers/specs/2026-10-18-admin-ops-workflows-design.md`](../specs/2026-10-18-admin-ops-workflows-design.md)

## Global constraints

- Frontend 2.0 tokens and kit; no hex in `.tsx`; copy says **business**; no vendor/env names on screen.  
- `requireSuperAdmin()` on every admin page and loader.  
- One lane per PR; no `server.js` or prod SQL in Desk PRs.  
- Never release prod DID +254709221536.

## Review focus

- Owner session cannot open `/admin`.  
- Release blocked on live active business (UI + server).  
- Archived businesses never appear as waiting.  
- Activity actor is session username, not typed name.

## Phase 1 — Shop hub (Desk)

- [ ] `adminWaitingModel.ts` + use in overview/pending  
- [ ] `AdminPageHeader` on Businesses + shop  
- [ ] `/admin/businesses/[id]` + `AdminShopPanel` (extract from list panel)  
- [ ] List rows link to shop; quick Assign on Needs you stays  
- [ ] Tests: waiting model, parent back target, shop route guard  
- [ ] `cd dashboard && npm run lint && npm run build`; `npm run test:mvp`

## Phase 2 — Clarity (Desk)

- [ ] Nav label Calls → Quality; Today section "Volume" vs quality tab  
- [ ] Today spark/delta on call count rows when data exists  
- [ ] `AdminPageHeader` on remaining admin index pages

## Phase 3 — Auth (Platform)

- [ ] Stop setting legacy cookie on admin login when Better Auth succeeds  
- [ ] Fail closed on missing `BETTER_AUTH_SECRET` in production  
- [ ] Document `ADMIN_OPERATORS` for prod  
- [ ] Tests in `adminAuth.test.js`

## Phase 4 — Search (Desk)

- [ ] `adminGlobalSearch(q)` server helper  
- [ ] Search field on Businesses (extend to header md+)

## Phase 5 — Ops gaps (when RPCs exist)

- [ ] Business edit, members, owner reset on shop page
