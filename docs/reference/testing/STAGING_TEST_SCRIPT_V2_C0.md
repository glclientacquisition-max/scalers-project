---
owner: brain
last_reviewed: 2026-10-22
status: reference
---

> **Reference only.** v2 staging test script as written by the Brain lane on 21–22 Oct 2026 for the draft stack. Staging only, never prod; it is not a record of results.
>
> Reference copy of the box brief `briefs/staging-test-script-v2-c0.md`. Paths under `/workspace/` are box paths and are not in the repo. See [STATUS.md](../../STATUS.md).

# Staging test script: v2 C0 lineage (`brain/v2-c0-lineage`)

Staging only. Platform builds the staging stack from this branch. No prod, no merge.

## Env on the staging stack

| Var | Value | Why |
| --- | --- | --- |
| `BRAIN_V2` | `on` | v2 brain |
| `BRAIN_V2_MODE` | `live` | v2 speaks (not shadow) |
| `VOICE_END_CALL_HONOUR` | `1` for calls 1–3, then `0` for call 4 | v2 `{line, end:true, reason}` hangs up after the goodbye plays |
| everything else (`VOICE_V2_CATALOGUE`, `SPOKEN_CATALOGUE_STORED_FIRST`, `BRAIN_V2_NLU_GAPS`, `VOICE_TURN_ARBITER`, `BRAIN_V2_TOPIC_PROPOSALS`, `VOICE_NO_ANSWER_DELETE`, `VOICE_FACT_REFS`) | unset (off) | C0 proves the lineage with features off; they get their own passes later |

Tenant: the staging cleaning tenant (home vertical, Nairobi areas listed, `tenants.agent_tools.end_call` = true).
Check after every call: `voice_turn_traces` + call log (SELECT only), look for `end-call signal source=v2_end` and the REST hangup line.

## Calls

| # | Say | Expect | Fail if |
| --- | --- | --- | --- |
| 1 | "Hi, what services do you offer?" then "No thanks, that's all. Bye." | Turn 1: plain categories (sim on the done_and_dusted fixture: "We do mattresses, sofas, carpets, windows, house cleaning by size, deep cleaning… and offices. Which would you like?"). Turn 2: **one** "Thank you for calling. Goodbye." then the line drops by itself within ~2 s of the goodbye ending | Two goodbyes; goodbye cut off; line stays open; raw SKU names ("1-Bedroom Deep Clean") read out |
| 2 | "Book sofa cleaning Friday at 10am in Kitengela, I'm Alvin." → at the read-back: "Okay wait, let me check with my wife." | No booking. Agent holds / offers to wait or call back. Line **stays open** | Any "booked/nimeweka"; appointment row created; hangup |
| 3 | Same booking, at the read-back: "No thanks, that's all. Bye." | No booking, one goodbye, hangup after it | Booking created; hangup before the goodbye plays |
| 4 | (`VOICE_END_CALL_HONOUR=0`) "No thanks, that's all. Bye." | Goodbye spoken; line is **not** dropped by us | Hangup from our side |
| 5 | "Sawa." ×3 (Swahili, pauses) | "Kuna kingine…?" twice, then "Kwaheri"; **no hangup** (ack run held, C3 decision) | Hangup after the third "sawa" |
| 6 | "Can you come Sunday at 3am?" | Closed/hours answer with the real hours | Offers 03:00 |
| 7 | "Do you work outside Nairobi?" / "Mnafanya nje ya Nairobi?" | Names the tenant's listed areas outside Nairobi (sim: "Yes, outside Nairobi we serve Kitengela, Juja, Ongata Rongai, and Syokimau.") or says it's Nairobi only | "Yes" with no areas; invented towns |
| 8 | "How much is sofa cleaning?" / "Bei ya carpet ni ngapi?" | Price from the catalogue spoken as words, ranges as "X to Y" / "X hadi Y", unit spoken ("per square metre", "kwa mita mraba") | Millions ("two million…"), digits glued together, unit dropped |
| 9 | "Book a deep clean in Rongai." | "Is that Ongata Rongai in Kajiado or Rongai in Nakuru?" | Picks one silently |
| 10 | "Ni services gani mna-offer?" then "Zipi hasa?" | Swahili categories ("Tunafanya usafi wa magodoro, sofa…"), then one level deeper | English answer; same list repeated |
| 11 | "Hello?" (bare) / "1001" | Greets once, asks how to help; no "I'm well, thank you" answer to an unasked question (known xfail BH_en_bare_hello, Brain) | Crash / silence |

Pass = calls 1–10 as expected. Report each call's id + pass/fail to the Brain lane.
