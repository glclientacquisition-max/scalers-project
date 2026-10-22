---
owner: brain
last_reviewed: 2026-10-22
status: reference
---

> **Reference only.** v2 staging test script as written by the Brain lane on 21–22 Oct 2026 for the draft stack. Staging only, never prod; it is not a record of results.
>
> Reference copy of the box brief `briefs/staging-test-script-v2-c2.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Staging test script: v2 C2 "one fact store" (`brain/v2-c2-fact-store`)

The draft PR is stacked on #853 (`brain/v2-c3-owns-call`), which sits on #849 and #848. Platform builds the staging stack. **Never run this on prod.** Only run SELECTs on staging. No migration is needed (see `briefs/_relay/fact-store-schema.md`).

## Flag combination (staging)
| Var | Value | Why |
|---|---|---|
| `BRAIN_V2` / `BRAIN_V2_MODE` | `on` / `live` | v2 live |
| `BRAIN_V2_TENANTS` | `<staging Jirani tenant id>` (A7 tenant: deep clean 1/2/3 bedroom, Karen KSh 800, 5 confirmed FAQs) | Scope |
| `BRAIN_V2_COMMIT_SAFETY` / `BRAIN_V2_OWNS_CALL` | `1` / `1` | C1 + C3 |
| `VOICE_END_CALL_HONOUR` | `on` | C0 |
| `BRAIN_V2_FACT_STORE` | `1` | **C2 (this PR)** |
| `SPOKEN_CATALOGUE_ON_SAVE` | `1` on the voice server **and** Desk | Compiles the store on owner Save |
| `VOICE_V2_CATALOGUE` | `1` | The call reads the stored doc (and its `facts`). Without it, the store is compiled on the call from the same rows; the answers are the same |

Run one control call with `BRAIN_V2_FACT_STORE` unset. Call A1 should then say **6,500** (today's A7 bug), which shows the flag is what changes it.

## Step 0: compile the store on Save (Desk, staging)
1. In Desk (Jirani, staging), open Settings → Services and press Save with no edits. Then edit one FAQ's answer (add a full stop) and Save again.
2. Check with SELECT only:
```sql
select spoken_catalogue->>'version' as v,
       spoken_catalogue->'facts'->>'sourceHash' as facts_hash,
       jsonb_array_length(spoken_catalogue->'facts'->'services') as services,
       jsonb_array_length(spoken_catalogue->'facts'->'faqs') as confirmed_faqs,
       spoken_catalogue->'facts'->'areas' as areas
from tenants where id = '<jirani id>';
```
   - Expect `facts` present, 7 services and 5 confirmed FAQs.
   - Expect Karen `fee.ksh = 800`.
   - The version goes up by 1 after the FAQ-only Save.
   - Log line: `[spoken_catalogue] tenant=<id> v<N> …`.
   - A Save with no changes logs `unchanged`.

## Calls
| # | Lang | Say | Expect to hear | Must NOT hear |
|---|---|---|---|---|
| A1 | EN | "How much is a deep clean for two bedroom?" | "Deep clean, two bedroom is nine thousand five hundred shillings." | six thousand five hundred |
| A2 | SW | "Bei ya deep clean ya vyumba viwili ni ngapi?" | "Bei ya Deep clean, vyumba viwili ni shilingi elfu tisa na mia tano." | elfu sita |
| A3 | EN | "How much is a 2BR deep clean?" | nine thousand five hundred | |
| A4 | EN | "How much is deep cleaning?" → "Two" | One question: "Deep clean for one bedroom to three bedroom homes. One bedroom, two bedroom, or three bedroom?" Then the 2-bedroom price | Any price before the size is given |
| A5 | SW | "Bei ya deep clean ni ngapi?" → "viwili" | "… Chumba kimoja, vyumba viwili, au vyumba vitatu?" Then "… elfu tisa na mia tano" | |
| A6 | EN | "How much is a 2BR clean?" | "Which one do you mean: Deep clean, two bedroom or Standard clean, two bedroom?" | A silent pick |
| A7 | EN | "Book a deep clean two bedroom Friday 10am in Kilimani, I'm Alvin." → "Yes" | Read-back with "deep clean, two bedroom", then booked | |
| A8 | EN | "How much for a bedsitter deep clean?" (Jirani has no studio row) | The which-size question | Any price |
| F1 | EN | "Do you come to Karen?" | "Karen is on our list of service areas. The travel fee to Karen is eight hundred shillings." | |
| F2 | EN | "Do you come to Kilimani?" | "… There is no travel fee to Kilimani." | |
| F3 | SW | "Mnafika Karen?" | "… Ada ya usafiri kwenda Karen ni shilingi mia nane." | |
| Q1 | EN | "Do you bring your own cleaning supplies?" | "Yes. Our team brings all supplies and equipment, …" | "How can I help you today?" |
| Q2 | EN | "How long does a deep clean take?" | "About 4 hours for a 1 bedroom, 5 to 6 hours for a 2 bedroom, and about 7 hours for a 3 bedroom." | |
| Q3 | EN | Platform adds a **suggested** (unconfirmed) FAQ in staging ("Do you clean swimming pools?") and Saves; then ask it | Not the FAQ answer (it is not in the store) | The suggested answer |
| P1 | EN | "How much is carpet cleaning?" (price mode ask) | "I don't have a price for that on our list. Would you like the owner to call you with a quote?" | Any number |

After A7, SELECT the row: `select service_name, start_at from appointments where tenant_id = '<jirani id>' and created_at > now() - interval '15 minutes';` It must show `Deep clean, 2 bedroom`. Use Platform's real column names.

## Retail item matcher (optional, only if a staging retail tenant has the Aris rows)
| # | Say | Expect |
|---|---|---|
| I1 | "Do you have a protractor?" | "Which one do you mean: 360 Degrees Protractor or 180 degree transparent protractor?" Never "not on our list", never "in stock" |
| I2 | "How much is a protractor?" → "the transparent one" | The which-one question, then "180° transparent protractor is one hundred eighty shillings." |
| I3 | "I need two PVC detachable T-squares" | Bound to "Pvc detachable t square", qty 2 |
| I4 | "Do you sell pencils?" | Not matched to any row (no "pen" prefix hit) |

Voice's #840 MATCHER pins (`tests/oldPathOrderGuardProdReplay.test.js`) fail with the flag on, as designed. The two todos pass. The replay test 'had those two been typed order…' line 90 (`catalog_item` miss) also flips. Delete those three assertions with the todo marks when C2 lands.
