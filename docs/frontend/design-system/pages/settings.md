# Settings `/settings` (Business)

**Job:** Teach and configure the Business Assistant.  
**This page is the knowledge IA benchmark.** Do not flatten it into one long form chrome.

See [`MASTER.md`](../MASTER.md) §§6.6–6.7, [`BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md`](../../BUSINESS_ASSISTANT_LANGUAGE_SYSTEM.md).

## Extracted IA (keep)

```text
Updates · Catalog · Train (header) · Import · Test
```

Train panels: Assistant, Hours, Locations, Policies, Team, FAQs, Tools & voice, Pronunciation.

Sticky Save on Catalog/Train. Updates/Import/Test use the same sidebar without inventing a second save.

Query params: `?tab=` and `?panel=`. Hash `#train` is not routed.

## Language

Owner-facing: assistant, train, line. Not “compile prompt” in chrome. Train means teach the assistant about the business, not fine-tune a model.

## Do not

- Split `TenantForm` unless a later phase cannot ship without it
- Add a live Online badge
- Redesign pronunciation as a marketing studio
- Add a global Assistant or Receptionist tab
