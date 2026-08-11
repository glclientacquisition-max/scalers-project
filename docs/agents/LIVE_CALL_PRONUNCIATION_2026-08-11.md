# Live call finding — ChapterOne pronunciation (2026-08-11 evening)

## Call under review

- **SID:** `HD_793cf820d034`
- **When:** 2026-08-11 ~18:07 UTC · **49s** · after-hours
- **DID:** +254709221536

### What happened (conversation)

1. Agent: after-hours greeting — ChapterOne / Aisha, still helping.
2. Caller: “When?”
3. Agent: hours Mon–Sat 9–7 + White Paper Books promo + **asks name**.
4. Caller: pushes back on name ask; “What do you guys do?”
5. Agent: books / delivery pitch + promo + **asks name again**.

### Pronunciation verdict

Transcript text is fine (`ChapterOne`, `Aisha`, `White Paper Books`). The phone *sound* problem was **lexicon pollution**, not missing training:

Before scrub (again after owner re-trained): 26 entries including `where→Ware`, `what→Wot`, `kenya→Ken-yah`, `City`, `Book`, …

Those overrides rewrite common English mid-sentence and make the agent sound broken even when the LLM text is correct.

**Live fix:** lexicon reset to 8 curated proper-noun entries. Studio now auto-scrubs on open + blocks common-word matches on Keep.

### Brain / UX notes (not pronunciation)

- Name-ask loop after “When?” / “What do you guys do?” — Brain lane.
- Dual “take your time” / invent patterns on earlier calls — already in LIVE_CALL_FINDINGS.

### Owner action

1. Merge/deploy pronunciation sanitize + studio packs.
2. Refresh Settings → Pronunciation studio (auto-clean if polluted).
3. Re-test call; listen for Eye-sha / Chapter One / clean address English.
