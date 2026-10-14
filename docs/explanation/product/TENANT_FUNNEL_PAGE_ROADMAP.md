---
owner: desk
last_reviewed: 2026-10-11
---

# Tenant Funnel Page — Product verdict + roadmap

**Date:** 2026-09-20 (rev 2 — founder refinement)  
**Was:** Tenant Funnel Card (`TENANT_FUNNEL_CARD_ROADMAP.md` superseded by this file)  
**Input:** Intelligence brief + founder refinement via Chief  
**Seat:** Product — no coding unlock yet  

---

## Verdict (unchanged calls; sharpened shape)

| Item | Call | One-line reason |
| --- | --- | --- |
| Ladder shape + **next major build** after honesty/notify gates | **ACCEPT (roadmap)** | Founder: not a distant maybe — first expansion build once unlock gate clears. |
| **Build now** | **DEFER** | Still blocked on honesty K1–K4 GO + notify-ledger hygiene. No Desk/Platform wake until gate. |
| P0 surface = **shop website-like page** (proof photos, place, services/hours) projected from tenant truth | **ACCEPT** | Must convert like a real shop page; still **no CMS / blog / SEO / theme builder**. |
| Full AI website builder / themes / blog / SEO-as-P0 | **KILL** | Page ≠ builder. Projection only. |
| Instant “booked” from the web | **KILL** | A1 wall. |
| Parallel web `lead_status` / Needs you invent | **KILL** | Second spine forbidden. |
| Vanity analytics as success | **KILL** | Success = request→Confirm/Hold Done. |
| `wa.me` click = delivered | **KILL** | Delivery vocab. |
| Second design system | **KILL** | One Scalers system. |
| Custom domain as P0 blocker | **DEFER** | `*.scalers.app` for P0. |
| Hospitality / IG / campaigns | **DEFER** | After Funnel Page P0. |

**Working name:** **Tenant Funnel Page** (replaces “Card” — founder: must feel like an effective shop site, not a thin CTA stub).

---

## Ladder placement (priority)

```
Desk honesty wedge → bookings honesty K1–K4 Release GO
Platform notify ledger hygiene (vocab-locked)
        ↓
>>> Tenant Funnel Page  = NEXT MAJOR BUILD <<<
        ↓
Custom domain → hospitality variants → IG / campaigns / Meta auto-reply
```

- **Priority:** First major expansion after unlock gate — schedule it; don’t park as “someday.”  
- **Not before:** K1–K4 GO + notify ledger that can refuse soft-sent lies.  
- **Before:** IG / campaigns / Meta auto-reply.  
- Does **not** reopen closed bookings honesty P0.

---

## P0 slice (when unlocked — not now)

### Surface (shop website-like, still projected)

| Block | Source of truth | Rule |
| --- | --- | --- |
| Business name + short pitch | Tenant profile | Required |
| **Pictures of their work** | Existing tenant media / work photos already in SoR (or brain-linked gallery fields) | Required for P0; if none, empty-state that does **not** invent stock “proof” |
| **Location / place** | Tenant address / map pin / service area already on tenant | Required; no fake pin |
| **Services** | Brain / tenant services list | Projected; no CMS editor on the page |
| **Hours** | Tenant hours | Projected |
| Optional: phone display | Tenant numbers | Display only; Call CTA does the dial |

**Still KILL on this page:** theme picker, blog, SEO pack, drag-drop builder, multi-page sitemap, fake testimonials, stock photos passed off as their work.

### CTAs + honesty (unchanged)

| CTA | Behavior |
| --- | --- |
| Call | `tel:` — claim **opened** only if logged |
| WhatsApp | `wa.me` — **opened**, never sent/delivered |
| Request visit (`home_services`) | → `appointments` @ `requested` → Needs you → **Confirm** |
| Request hold (retail) | → `service_requests` @ `open` → Needs you → **Hold Done** |

**Customer copy (exact):** **“Request sent. The business will confirm.”**  
Never booked / confirmed / reserved before Confirm. No Meta/IG skip.

### Ops + metrics

- Host: `{slug}.scalers.app` only for P0  
- Notify: **desk-only** Needs you first slice; owner push only with honest sent/failed  
- Spam: rate limit + honeypot required  
- Metrics: `source=funnel_web` on row; success = request→Confirm/Hold Done (48h), time-to-Confirm — **not** pageviews alone  

**Seats when unlocked:** Product patch → Platform (host/CDN/media) + Desk Builder (form→SoR + source) + Desk UX (page layout: photos / place / services / hours / CTAs) → Critic → Release.

---

## Defaults (open Qs — still Product defaults)

1. Unlock after K1–K4 + notify hygiene — funnel does not jump Meta Cloud send.  
2. **Call-first**; WA second.  
3. **`home_services` visit first**; retail hold second.  
4. `*.scalers.app` OK for P0.  
5. Spam controls required in P0.  
6. Source tag required.  
7. Desk-only notify for first slice.

---

## Unlock gate

1. Bookings honesty K1–K4 Release GO.  
2. Critic PASS on funnel copy + no fake proof photos.  
3. Staging TEST: page shows real tenant photos/place/services/hours + request→Needs you with `source=funnel_web`.  
4. Chief routes seats — Product does not fan out coding.

**Kill if unlocked early or scoped as builder:** “booked” copy, new status field, wa.me=delivered, theme/blog/SEO builder, stock-as-proof.

---

## Delta vs rev 1 (Card)

| Rev 1 | Rev 2 (founder) |
| --- | --- |
| “Card” thin CTA surface | **Funnel Page** — shop website-like |
| Ladder “after gate” (soft) | **Next major build** after gate — explicit priority |
| Content underspecified | **Required:** work photos, location/place, services, hours (all projected) |
| CTAs / honesty / KILLs | Unchanged |
| Build now | Still **DEFER** |

---

## Founder line

**DEFER build; ACCEPT as next major ladder page.** After honesty + notify gates: `{slug}.scalers.app` shop-like page from tenant truth (work photos, place, services, hours) with Call | WA | Request visit/hold into existing spines and “Request sent. The business will confirm.” Not a website builder. No coding until unlock.
