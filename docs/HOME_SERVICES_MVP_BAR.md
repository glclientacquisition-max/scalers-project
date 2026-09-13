# Home services MVP bar of excellence

**Lane:** Brain (playbooks, seeds, live pack). Desk copy only where the vertical blurb or Train seeds show.  
**SoR:** `appointments` for visits. Inbox → Visits (list + week). No Google Calendar.  
**Beachhead tenant:** cleaning (live corpus: Done and Dusted / Shy). Other trades use the **same spine** with Train catalog, not a second vertical.

This is the bar to **proceed** on home services MVP. Phase 2 plumbing is already in repo. Excellence is live visit quality plus niche-correct knowledge, not more calendar chrome.

---

## What we investigated

One product pack (`vertical = home_services`). Niches below are **Train catalogs**, not new code verticals.

| Niche | Typical caller job | Excellence on the phone | Do not invent |
| --- | --- | --- | --- |
| **Cleaning (beachhead)** | House, Airbnb, carpet, couch, mattress | Book as a visit; same-day if hours allow; quote on site unless a band is in Train | ETA, chemical names, square-metre price |
| Plumbing | Leak, blocked drain, install | Book unless burst / flood | “We will be there in 20 minutes” |
| Electrical | Outlet, lighting, install | Book; **shock / live wire / fire** is emergency | That the team will isolate mains |
| Handyman / general repair | Fix, hang, assess | Repair / assessment visit | Parts on the van |
| Installation | Fixture or equipment | Install visit; quote on site | Fit guarantee |
| Pest control | Spray / inspect | Visit if listed; out_of_scope if not | Product brand or “safe for kids” |
| Painting / roof / garden | Quote-heavy site work | Assessment visit; coverage honesty | Duration or crew size |
| HVAC / appliance | Diagnose | Assessment unless listed as repair | That the part is in stock |
| Moving | Van + window | Out of MVP unless listed in Train | Capacity or price |

Hospitality (rooms, tables) is a **different vertical**. Do not fold it into this pack.

---

## Shared spine (all home niches)

Every home-services DID must do this without a niche-specific playbook:

1. **Intro:** `{Good morning|Hello|Good evening}, this is {agent} at {business}. How can I help you?` No service dump. No language invite on the opener.
2. **Hours / closed:** From schedule + bulletin. Honesty, then still help.
3. **We come to you / coverage:** From locations + policies. Outside area: decline or note a callback. Never promise a visit off-map.
4. **Price:** `price_range` from SERVICES, or “quoted on site”. Never a made-up shilling amount.
5. **Book:** service + name + when + landmark → `create_appointment`. Speak nothing until the backend. Progress: “Okay, one moment.”
6. **Same hour:** A second visit in the same hour is allowed unless POLICIES say one at a time.
7. **Reschedule / cancel:** `update_appointment` on the caller’s latest open visit. Hours still gate. Attendance confirm is not a second booking.
8. **True emergency only:** burst pipe, flooding, fire, gas leak, electric shock. Capture name + reason and escalate. Same-day, urgent, or ASAP cleaning is a **visit**.
9. **Owner notify:** Usable reason (job + when + place). Inbox list for Confirm; week as run sheet.
10. **Unknown:** Fallback line. Log enquiry. Do not bluff.

---

## Cleaning beachhead extras (Train, not new tools)

Live calls already ask for couch, carpet, mattress, house, Airbnb, roof. Seeds must list those jobs so the model is not guessing “general repair”.

| Ask | Pass |
| --- | --- |
| “Urgent Airbnb tomorrow Runda” | Visit, not escalate |
| “Mattress tomorrow 10 AM Rongai” | Saved requested visit |
| “How much for carpet?” | Band or quoted on site |
| “Do you cover Kiambu?” | Coverage from policies |
| Sunday / outside hours | Not persisted; offer another time |

Owner must replace seed names with their real menu after onboarding. Empty Train is a knowledge fail (class **K**), not a Brain fail.

---

## Automated vs live

| Gate | Proves |
| --- | --- |
| `npm run test:brain` + `npm run smoke:home` | Classify, slots, hours, same-hour insert, cleaning vs emergency |
| `npm run test:mvp` | Spine still green with retail |
| **Live DID pack below** | The only GO for “home MVP proceed” |

CI cannot mark the live pack done.

---

## Live DID pack (home / cleaning)

Call the home-services DID. Log SID, pass/fail.

| # | Say | Pass if |
| --- | --- | --- |
| 0 | *(listen)* | Brand + agent. No service list. No language invite. |
| 1 | “Are you open Saturday?” | Hours from file. No forced name. |
| 2 | “Do you cover [area you do]?” | Honest coverage. |
| 3 | “Do you cover [area you don’t]?” | Decline or callback. No fake visit. |
| 4 | “How much for carpet cleaning?” | Band or quoted on site. No invented price. |
| 5 | Incomplete: “Can you come clean my sofa?” | Asks only the missing slots (name / when / landmark). |
| 6 | Complete book: named job + name + weekday time + landmark | Row in Inbox Visits as requested. Owner notified. Caller not told “booked” before the tool. |
| 7 | Same-hour second book (different caller or name) | Also saved unless policy says one at a time. |
| 8 | “Please move my visit to Friday afternoon” | Same row updated. Hours still apply. |
| 9 | “Cancel my visit” | Status cancelled after backend speaks. |
| 10 | “Urgent Airbnb clean tomorrow” | Visit, not emergency escalate. |
| 11 | “Burst pipe, kitchen flooding” | Escalate path. No fake ETA. |
| 12 | Closed day / late night time | Not persisted. Offer another time. |
| 13 | One Kiswahili turn | Language match after the caller speaks. |

**Home GO:** `test:mvp` green + Train has real services/hours/coverage/notify + pass **0, 1, 6, 10, 11, 12** every time + ≥10/14 overall + one real owner SMS/WA/email with job + when + place.  
**Home NO-GO:** invented price/ETA/coverage; “urgent clean” treated as emergency; false “saved/booked”; silent miss on a complete book; Sunday persisted.

**Private-beta home claim:** the DID books visits the owner can run. Not Google sync, not live transfer, not per-niche chemicals, not drag-on-week calendar.

---

## Explicitly not this bar

- New verticals or schema for pest vs plumbing vs cleaning
- Google Calendar, click-empty-day, capacity UI
- Live transfer
- Caller SMS on by default
- Hospitality rooms
- Learning-loop FAQ mining (roadmap slice 7) until this live pack is green

---

## Code map

| Piece | Path |
| --- | --- |
| Playbook | `src/conversation/playbooks/homeServices.js` |
| Tools | `src/conversation/toolExecution.js` (`create_appointment` / `update_appointment`) |
| Intro | `src/conversation/businessAssistantIntro.js` |
| Seeds | `dashboard/src/lib/homeServicesOnboardingPack.ts` |
| Compiler job line | `dashboard/src/lib/promptCompiler.ts` |
| Smoke | `scripts/smoke-home-services-playbooks.js` |
| Phase 2 plan | `docs/HOME_SERVICES_PHASE2.md` |
| Retail MVP (still required) | `docs/MVP_SHIP_AND_TEST.md` |
