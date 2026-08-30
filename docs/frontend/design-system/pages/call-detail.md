# Call detail `/calls/[id]`

**Job:** Understand and act on one interaction.  
**This page is the split-pane benchmark.** Do not replace the layout.

See [`MASTER.md`](../MASTER.md) §6.5.

## Extracted layout

- Back link preserves `?from=`
- `lg`: 4-column sticky summary + 8-column conversation
- Small screens: stack (constitution exception to the mandate)
- Left: identity, summary card, primary follow-up, muted Done/Archive, then metadata
- Right: transcript bubbles, FAQ suggestions

## Keep

Caller/receptionist bubbles, urgent treatment, `LeadStatusToggle`, recording player.

## Debt (do not invent a new detail page)

- Primary “Reply on WhatsApp” is blue fill with a green glyph (`TriageLeadCard` recipe). Consumed in Phase 5.
- Caller number appears in the header and again in a Caller card. Fine to leave; do not add a third copy.
- Back link label is “Back”. Destination still honors `?from=`.

Transcript stays the main reading surface. Do not move it under the summary on desktop.
