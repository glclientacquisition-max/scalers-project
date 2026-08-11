# ChapterOne Bookstore — setup review (2026-08-11)

Tenant: `9f3ff5d6-f189-46c9-8c2d-4bb15f07aecf`  
DID: `+254709221536` · Agent: **Aisha** · Vertical: retail bookstore

## What looks solid

| Area | Status |
| --- | --- |
| Identity | Aisha / friendly / escalate+end_call on |
| Hours | Mon–Sat 09:00–19:00 EAT, Sun closed — schedule matches prose |
| Services | Sales, sourcing, Nairobi same-day, countrywide shipping |
| FAQs | Location, hours, delivery, special orders, how to order |
| Unknown fallback | Sourcing quote line — good for retail |
| Bulletin | White Paper promo + Manga available (active) |
| Prompt | Answer-first, short turns, no invent prices |

## Fixes applied

1. **Applied `tts_lexicon` column** (was missing → voice profile 400s / empty lexicon).
2. **Trained tenant pronunciation** for ChapterOne, Aisha, Muindi Mbingu, City Market, Manga, White Paper Books.
3. **Normalized WhatsApp** `0740442943` → `+254740442943`.
4. **Corrected street spelling** `Miundi Mbingu` → `Muindi Mbingu` in prompt / FAQs / hours notes.
5. **Global lexicon** extended with bookstore + common Kenyan name pronunciations (code).

## Remaining recommendations (Desk / Brain)

| Item | Why |
| --- | --- |
| Re-save / recompile Settings once | Picks up address fix into any derived fields; confirm bulletin still active |
| Add executive FAQ? N/A | Bookstore — add FAQs for payment (M-Pesa), returns, opening stock |
| Team directory | Only “Sales” — add owner name if escalation should be personal |
| Holding-line ban | Still needed in prompt (“never say take your time / one moment”) from live call findings |
| Website URL spoken form | `chapteronebookstore.co.ke` may be spelled letter-by-letter awkwardly — optional lexicon later |

## Pronunciation checklist (live smoke)

Call the DID and listen for:

1. “Chapter One Bookstore” / “Ah-ee-sha”
2. “Moo-een-dee Mbeen-goo Street”
3. “Man-gah books”
4. “White Paper Books … one thousand shillings” (money expansion, not “K S H”)
