---
owner: brain
last_reviewed: 2026-10-21
---

# BA v2 fact store (`BRAIN_V2_FACT_STORE`, off by default)

Plan row C2 (`briefs/v2-greeting-and-path-plan.md`), bottleneck A7, brain-gaps 2026-10-21 §2. Code: `src/knowledge/factStore.js`, read by `src/conversation/v2/nlu.js` (binding), `src/conversation/v2/machine.js` (answers, which-one question) and `src/conversation/productCatalog.js` (`findProductMatch`).

## One store, compiled at Save

The store is part of the spoken-catalogue rebuild on owner Save (#702, `SPOKEN_CATALOGUE_ON_SAVE`). It is not a new pipeline. With the flag on, `buildDoc` adds `doc.facts` to the same `tenants.spoken_catalogue` JSON, so no new column is needed:

| Part | What it holds |
|---|---|
| `services[]` | id, name, family, variant `{kind: bedroom/seater/pack/kg/sqft/litre, value}` (studio and bedsitter are bedroom 0), typed price `{mode, min, max, amount, unit, confirmed, say}`, and the owner row |
| `products[]` | id, cleaned name (the mojibake `Â°` is fixed), normalized tokens, sku and alias tokens, typed price, `inStock` (true only when the row says so) |
| `areas[]` | id, name, fee `{mode, ksh}`, eta, confirmed, and the spoken fee line in EN and SW |
| `policies[]` | the spoken policy lines |
| `faqs[]` | confirmed FAQs only (`status: 'confirmed'` or `confirmed: true`, and a fact under GIGO provenance) |

`facts.sourceHash` covers services, products, areas, policies and FAQs. With the flag on, `needsRegeneration` is also true when the facts are missing or stale, so an FAQ-only Save rebuilds and bumps the version. The Save rebuild then also selects `faqs` and `business_policies`. Desk pings on an FAQ save too (`SPOKEN_CATALOGUE_FIELDS` has `faqs`), and the ping is a no-op when nothing changed.

On a call, `factsFor(profile)` reads the pinned doc's facts, else the stored doc's facts when they are fresh, else it compiles them from the same rows (memoised).

## What reads it (flag on)

- **Binding.** Family words pick the rows and the caller's size words pick the variant: EN/SW one/two/three-bedroom, 1BR/2BR, studio, bedsitter, chumba kimoja, vyumba viwili, seaters, small/large. If the size is unclear, or two rows tie, the caller gets one which-one question ("Deep clean for one bedroom to three bedroom homes. One bedroom, two bedroom, or three bedroom?"). It never takes the first row (A7). The caller's answer ("two", "viwili", "the 2 bedroom one") re-reads the held turn.
- **Items.** Matching uses normalized whole tokens: case, punctuation, hyphens, plurals and `°`. Substrings and prefixes never match. A product is ambiguous when several rows are heard by the same words ("Protractor": 2 rows), and then the caller is asked which. `findProductMatch` uses the same matcher, returns `ambiguous` and `candidates`, and flips Voice's #840 MATCHER pins.
- **Prices.** A price is the typed value, range or unit. The owner's own price text is spoken only when it reads as the typed numbers. An `ask` or unconfirmed price is never spoken.
- **Area fee.** A coverage answer for a listed area with a confirmed fee adds the fee ("The travel fee to Karen is eight hundred shillings." / "There is no travel fee to Kilimani."). An unconfirmed fee is not spoken.
- **FAQs.** A question that matches a confirmed FAQ gets its answer. A seed or suggested FAQ is not in the store, so it is never spoken.
- **Receipts.** The read-back and the write carry the bound fact row's name, for example "Deep clean, 2 bedroom".
- **A4 seam.** `itemFromFacts(facts, {id, name, qty})` has the same shape as `itemFromCatalogue`, for #838 `summaryReceipts` to call.

## Staging flags

`BRAIN_V2_FACT_STORE=1` on the voice server with the C3 set (`BRAIN_V2=on BRAIN_V2_MODE=live BRAIN_V2_TENANTS=<id> BRAIN_V2_COMMIT_SAFETY=1 BRAIN_V2_OWNS_CALL=1 VOICE_END_CALL_HONOUR=on`). For the stored path, also set `SPOKEN_CATALOGUE_ON_SAVE=1` on the voice server and Desk, plus `VOICE_V2_CATALOGUE=1`. Without these, the store is compiled on the call from the same rows.
