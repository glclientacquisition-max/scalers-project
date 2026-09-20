# Scalers Company Brain

**Status:** Approved v0.2 — founder + Chief (2026-09-20 EAT)  
**Audience:** Every Scalers bot must read this before acting.  
**Owner:** Scalers Chief maintains; Scalers Product owns product facts; founder owns irreversible calls (pricing final, first customer relationships, taste).  
**Repo path (when landed):** `docs/company/COMPANY_BRAIN.md`

This is the shared business brain. If a bot’s brief conflicts with this doc, **this doc wins** until Chief/Product update it.

**How to read this doc:** §1 is the **north star** (where we’re going). §3 is the **wedge** (what we ship now to earn the right to expand). Bots must not skip the wedge to build the north star early.

---

## 1. North star — business intelligence that runs the business

### Layer 1 — Company OS (bots + founder)
Specialized bots *are* Scalers Inc’s operating system: build, honesty gate, release evidence, intelligence, platform, and (later) growth/discovery/success. Founder decides taste, closes relationships, and owns irreversible money/trust calls.

### Layer 2 — Product (end state)
Scalers is the **operating brain for a Kenyan SME** — a platform that deeply understands *that* business and can run most of it from one place.

**Capable of (north star):**
- **Deep business intelligence** — learn the business from real work (customers, conversations, appointments, money, people, outcomes), not from a static profile form
- **All customers, one brain** — know who they are, what they want, what’s owed, what’s promised, what’s next
- **Reply and act across channels** — WhatsApp first; then Instagram and other surfaces the owner already uses — with replies grounded in that business’s truth
- **Run growth loops** — campaigns, follow-ups, re-engagement — without lying about delivery or inventing fake “Online”
- **Owner still in command** — the desk surfaces honest next actions; automation never fakes a send, a ring, or a cleared Need

**Not the north star:** a dumb shared inbox, a KPI wallpaper, a softphone toy, or a chatbot that doesn’t know the business.

**One line:** *Understand the business deeply → handle customers and operations across channels → grow it — with honesty as the product law.*

---

## 2. ICP (who we serve)

| Field | Definition |
| --- | --- |
| Who | Owner-operators of Kenyan SMEs who live on their phone |
| Job | Run the whole business day-to-day: customers, replies, follow-ups, team handoffs, and (later) campaigns — without drowning in apps |
| Context | WhatsApp-first today; Instagram and other channels in the expansion path; M-Pesa world; hates fake “Online” / fake “sent” |
| Not ICP (yet) | Enterprise contact centers, pure softphone/PSTN buyers, dashboard-only managers who never touch the phone |

**Primary wedge user (now):** the owner on a ~390px phone, clearing **Needs you** between real work.  
**Expansion user (later):** same owner, trusting Scalers to reply and campaign *as* the business because the intelligence is real.

---

## 3. Wedge (PMF bet — ship this first)

**Why a wedge exists:** the north star is a multi-channel business OS. PMF is won on **one high-pain workflow** done honestly. Expanding to Instagram, campaigns, and full auto-reply *before* the desk is trusted will ship lies and burn the brand.

**One sentence (now):** Honest phone triage — faster clear next action, never lied to by the desk.

**In / out (now)**
- **In:** Needs you, call detail, Contacts Call/WA, Team ping/escalation *truth*, WhatsApp write-back honesty, whose-turn / next-step language
- **Out (now — deferred, not forever):** Instagram inbox, multi-channel auto-reply brain, campaign engine, full Meta Cloud send stack — these unlock **after** the wedge is trusted (see §7 expansion ladder)
- **Out (killed forever unless founder reverses):** KPI wallpaper, fake Online, inventing PSTN live transfer as product, parallel `lead_status` / Needs you / notify state machines, glassmorphism second visual language, Baileys/unofficial WA Web

**Bessemer rule we follow:** one ICP, one high-pain workflow, measure retention before expanding surface area.

---

## 4. Product law (non-negotiable — applies to north star too)

1. **Never lie to the operator or the customer.** No soft “Escalation sent,” no “Rings {name}” when live transfer is off, no Confirm/Done without a real visit/hold row, no “replied” without a real channel result.
2. **Opened ≠ delivered.** `#358` wa.me click write-back is “opened/followed up,” not Meta Cloud delivery. Delivery ladder labels are vocab-only until Platform is on the roadmap (Product + Critic lock words first).
3. **Intelligence before automation.** We do not auto-reply or campaign at scale until the business brain has enough honest state to ground the message.
4. **One visual language.** Phone-first desk chrome; no second design system.
5. **Staging is a TEST account.** Ignore badge volume; judge control design and honesty copy. Staging: `https://scalers-staging.vercel.app/`
6. **Repo:** `glclientacquisition-max/scalers-project`

---

## 5. Hard kills (do not build / do not pitch)

- Fake Online / presence-as-availability
- Baileys / unofficial WhatsApp Web automation
- PSTN / conference live transfer as a product promise
- Parallel status machines beside `lead_status` / Needs you / notify
- Rebuilding snooze/unread as a parallel attention channel (inbox verb cut removes them)
- Intelligence → Builder coding orders (must go Product → Chief)
- Shipping Instagram / campaigns / auto-reply **before** wedge Release GO + whose-turn trust (expansion ladder)
- Migrating host mid-ship for #364 (stay on Vercel through wedge; Cloudflare = later spike only)

---

## 6. Pricing thesis (commercial — DEFERRED until ops wedge is green)

**Direction (not live packaging yet):**
- Phone-first **owner seat**, priced in **KES** (~1.5k–5k/mo anchor band from market scans — founder locks final)
- Short trial (5–14 days), **M-Pesa / local card**
- Always separate in copy: (1) Scalers subscription, (2) carrier/voice if any, (3) Meta/BSP WhatsApp fees (esp. post Oct 2026 service/utility charges)
- Retention hook: **weekly honesty summary** (Needs you cleared / visits confirmed) — actions, not vanity KPIs
- Later: channel packs / campaign usage priced honestly (never hide Meta fees inside “unlimited messaging”)
- No silent auto-charge after trial; don’t imply free WA Business app is billed; no PSTN/Online in sales copy

**Unlock for Growth work:** after `#364` Release GO + whose-turn on the ops queue (Product).

---

## 7. Expansion ladder (north star → sequenced)

Do not reorder without Product + founder.

1. **Honest desk wedge** — #364 → whose-turn → inbox verb cut → contact strip  
2. **Business memory deepening** — contact/timeline truth, Meta delivery vocab (Product+Critic), Platform when send stack is real  
3. **Assisted replies** — drafts grounded in business state; owner taps send (honesty first)  
4. **Trusted auto-assist** — bounded auto-replies where confidence + policy allow  
5. **More channels** — Instagram (and others) into the *same* brain — not a second inbox product  
6. **Campaigns / growth loops** — re-engage and acquire using the same intelligence and delivery truth  

**Bot seats that unlock with the ladder:** Platform (channels + delivery), Growth (campaigns + KES packaging), Discovery (ICP language), Success (activation). Desk Builder/UX stay the wedge until 1–2 are solid.

---

## 8. Ops coding sequence (current)

1. **#364** Needs you row recipes — founder upgrading **Vercel Pro (~$20)**; backup retry routine **11:30 EAT Mon 21 Sep**
2. **Whose-turn / next-step** on Needs you (ACCEPT queued — no new status field)
3. **Inbox verb cut** (remove snooze/unread)
4. **Contact activity strip** (DEFER after whose-turn)

**Notes track (non-coding):** Meta delivery vocab (Product + Critic); Chatwoot/Twilio shapes deferred; Brief 2 closed.

**Host:** Stay on Vercel through wedge. Cloudflare Pages/OpenNext = later notes-only Platform spike if Pro + fewer previews still aren’t enough.

---

## 9. Crew roster (who does what)

| Seat | Id (when known) | Owns | Does not |
| --- | --- | --- | --- |
| Chief | this agent | Intake, routing, roster, scoreboard, Company Brain | Coding, inventing semantics |
| Product | 4468441 | P0, specs, ACCEPT/DEFER/KILL, ladder sequencing | CloudAgent PRs |
| Desk Builder | 4455779 | Desk behavior PRs via CloudAgent | Strategy critique |
| Desk UX | 4458824 | Placement / interaction | Voice brain, wallet, Meta product |
| Critic | 4414861 | Honesty gate on status/notify/auto-reply claims | Shipping features |
| Release | 4468442 | Staging smoke GO/NO-GO | Soft “seems fine” |
| Intelligence | 4472792 | Opportunity briefs → Product | Roadmap / coding orders |
| Platform | *(not seated)* | Channels, voice/notify, Meta delivery, wallet, campaign send plumbing | Desk chrome polish |
| markert researcher | 4390689 | Founder’s other use | Scalers (do not retarget) |

**Phase B (after #364 GO + wedge stable):** Customer Discovery, Growth/GTM (campaigns + packaging), Success/Onboarding.  
**Cap:** ~10 Scalers bots until paid retention signal. No second PM, second Critic, or “CEO bot.”

**Handoff law:** Intelligence → Chief → Product verdict → Chief routes. Cross-seat work via Chief or a shared channel — no fan-out.

---

## 10. Weekly scoreboard (what “progress” means)

Track these every week (Chief surfaces; seats feed evidence):

### Build / honesty
- P0 shipped + Release GO/NO-GO count
- Open honesty defects (lying verbs, soft sent, fake Online)
- Deploy health (preview success rate; avoid burning deploy quota)

### Product wedge
- Needs you → clear next action time (qualitative until instrumented)
- Confirm/Done only when rows real (Release samples)

### Business OS (as ladder unlocks)
- % of customer threads Scalers can answer with grounded context
- Assisted-reply accept rate (owner edits vs sends)
- Channel coverage (WA → IG → …) without second-inbox sprawl
- Campaign sends with delivery truth (sent/delivered/failed — never fake)

### Business (Phase B+)
- Trials started / paid seats (KES)
- Day-7 activation: Needs you cleared or visits confirmed
- “Very disappointed if Scalers gone?” (PMF survey when we have users)
- Churn reasons (Discovery)

If a bot can’t name which scoreboard line it moves, it should not start work.

---

## 11. Effectiveness bar for every bot

1. One outcome metric  
2. Sharp brief that refuses off-scope  
3. Reads this Company Brain  
4. Handoff format Chief can route  
5. Cadence (routine) when “constant” is required  
6. Kill criteria / self-stop  
7. **Respects north star vs wedge** — no skipping the ladder

---

## 12. Near-term calendar

| When | What |
| --- | --- |
| Now | Founder finishing Vercel Pro; Desk UX on #364 hold; Release standing by |
| Pro live | Chief retriggers #364 deploy → Release smoke |
| Else | Routine `#364 deploy retry + Release smoke` at 11:30 EAT 21 Sep |
| After #364 GO | Product whose-turn one-pager → UX; then verb cut |
| After wedge green | Seat Platform; unlock Growth packaging; Discovery interviews; begin ladder step 2–3 |

---

## 13. Change log

- **2026-09-20** — v0.1 drafted by Scalers Chief from live crew decisions.
- **2026-09-20** — v0.2 north star expanded: business intelligence OS (multi-channel customers, grounded replies, campaigns) with explicit expansion ladder; wedge kept as PMF path; product law adds intelligence-before-automation.
