# Wayfinder: desk as a daily product

**Destination:** Owners use Scalers on phone and laptop every morning without being taught.  
**Notes:** Full research in [`docs/specs/desk-daily-product.md`](../desk-daily-product.md). Constitution still outranks this map.  
**Claimed by:** desk research 2026-09-10

## Decisions so far

- Do not greenfield a second design system or install shadcn to “look like Linear.”
- Copy Linear/Stripe **discipline** (density, one accent, honest data, fast taps), not their pixels.
- Highest leverage is an adaptive **shell**: one nav list, bottom tabs on phone, top links on `md+`.
- Constitution §8: phone bottom tabs; `md+` top links; no left desk rail. Sign out in the header.
- Inbox stays the collection benchmark; phone gets a dense stacked row, not cards.
- Contacts stays a primary thumb tab in the shell pass (no More overflow yet).

## Not yet specified

- Exact container-query breakpoint for Inbox stacked rows.
- Whether cmdk is Phase 5 or later.

## Out of scope

- Voice, Brain, wallet RPCs, DID, Super Admin, React Native, dark mode as a prerequisite.

## Frontier

### research / Shell vs constitution

**Answer:** Tab bar is a presentation of `DESK_LINKS`. Constitution amended. Shell code in `DeskNav` + `(desk)/layout.tsx`.

### task / Shell implementation

In progress on the desk phone-shell branch.

### task / Inbox phone rows

Blocked by: nothing in the shell. Do not mix into the shell PR.

### task / Optimistic lead status

Blocked by: nothing technically; do not mix into the shell PR.
