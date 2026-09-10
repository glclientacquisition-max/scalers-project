# Wayfinder: desk as a daily product

**Destination:** Owners use Scalers on phone and laptop every morning without being taught.  
**Notes:** Full research in [`docs/specs/desk-daily-product.md`](../desk-daily-product.md). Constitution still outranks this map.  
**Claimed by:** desk research 2026-09-10

## Decisions so far

- Do not greenfield a second design system or install shadcn to “look like Linear.”
- Copy Linear/Stripe **discipline** (density, one accent, honest data, fast taps), not their pixels.
- Highest leverage is an adaptive **shell**: one nav list, bottom tabs on phone, top links on `md+`.
- Bottom tabs require a constitution §16 amendment before code.
- Inbox stays the collection benchmark; phone gets a dense stacked row, not cards.

## Not yet specified

- Whether Contacts is a primary thumb tab or sits under More.
- Exact container-query breakpoint for Inbox stacked rows.
- Whether cmdk is Phase 5 or later.

## Out of scope

- Voice, Brain, wallet RPCs, DID, Super Admin, React Native, dark mode as a prerequisite.

## Frontier

### research / Shell vs constitution

Constitution §16: top bar + drawer; no second desk sidebar in Phases 3 to 5. Spec argues a phone bottom bar is the same destinations, not a sidebar.

**Answer:** Treat the tab bar as a presentation of `DeskNav` `LINKS`. Needs an explicit product yes, then a small constitution amendment, then shell code.

### task / Shell implementation

Blocked by: constitution amendment.

### task / Inbox phone rows

Blocked by: shell (padding for the tab bar).

### task / Optimistic lead status

Blocked by: nothing technically; do not mix into the shell PR.
