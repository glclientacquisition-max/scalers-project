---
owner: brain
last_reviewed: 2026-10-18
---

# Caller identity and summary (runtime contract)

**Status:** Locked with [`CALLER_FILE_MODEL.md`](../product/CALLER_FILE_MODEL.md) (Alvin GO · 7 Oct 2026)  
**Fixture call:** HD_c05cdda9684d (Done and Dusted staging)  
**Lane:** Brain owns goal / summary / bind matchers / file speakable flags. Voice plumbs unfinished/weak labels and consumes the same speaker SSOT + speak-gate.

## Why this exists

Staging call HD_c05cdda9684d showed three fundamentals breaks:

1. Unfinished Kiswahili STT (`Nilikuwa nauliza`) became Goal / brain_summary / judged first_forward.  
2. Voice spoke `Je, naongea na Alvin?`; caller replied `Eeh, unaongea na Alvin?…` — Brain never set `nameConfirmed`; mouth still used the file name and open rows.  
3. Hangup resolution and post-call transcript review disagreed with summary JSON on intent/resolution.

This doc is the enforceable contract. Code must match it; prompts alone are not enough.

---

## 1. Speaker SSOT

One object on call state (Brain owns). Voice identity stage reads/writes only through it (or a mirror that cannot disagree).

```
speaker: {
  pendingName: string | null,
  askSpoken: boolean,
  askLanguage: 'en' | 'sw' | 'sheng',
  name: string | null,
  nameConfirmed: boolean,   // THE bind flag
  boundRole: 'primary' | 'alternate' | 'other' | null
}
```

### Lifecycle per call

| State | Meaning | Speakable |
| --- | --- | --- |
| `candidate` | ANI keyed a card | Shop greeting; one identity ask. No open rows, history, or vocative file name. |
| `name_pending` | `askSpoken` true | Waiting confirm / deny / other name. |
| `bound` | `nameConfirmed === true` | File rows when caller asks; vocative name allowed. |
| `unbound_other` | Denied / different person | No household rows. |

Rules:

1. Every call starts `candidate` — never pre-bound from a previous call.  
2. One identity ask, in **locked reply language** pack line.  
3. Confirm binds; deny / other-name does not inherit primary rows.  
4. Hard gate before any TTS that asserts open visits/requests/history or addresses the caller by file name: `nameConfirmed === true` (same flag Brain + Voice).  
5. NBA “rows on this number” must not leak into model speech before bind.  
6. Confirm once; never re-ask; never claim unconfirmed while using the name or file.

### Kiswahili / pack confirm matchers (required)

Confirm matchers must accept pack language, not English-only whole-utterance shapes:

- Affirm: `yes` / `yeah` / `ndiyo` / `ndio` / `eeh` / `sawa` **plus** optional echo `unaongea na {pending}` / `naongea na {pending}` / `speaking with {pending}` / bare `{pending}`.  
- Compound replies allowed: `Eeh, unaongea na Alvin? …` must bind when pending is Alvin and ask was just spoken.  
- `agentAskedPendingName` must recognize `Je, naongea na {name}?` and en/sheng pack equivalents — not only `Am I speaking with`.  
- SpeechGuard: drop vocative file name and file-row claims when `!nameConfirmed`.

---

## 2. Goal and summary — single writer

**Owner:** Brain post-call summary path (`callSummary` + hangup persist). Voice may supply labels (`unfinished`, `weak_stt`); Brain decides goal text.

### Schema spine (summary JSON and desk columns must agree after final write)

```
goal: {
  text: string | null,
  source: 'caller_job' | 'file_read' | 'faq' | 'handoff' | 'none',
  quality: 'grounded' | 'unknown'
}
primary_intent: enum (existing desk taxonomy)
resolution: enum
resolution_note: string | null  // must match resolution class
```

### Never allowed as `goal.text`

Reject at observe **and** at write. A greeting in front of the stem does not make it a goal (`Mm-hm. Namna gani, Shy? Nilikuwa nataka kujua.` is the same class as `Nilikuwa nauliza`).

- Unfinished STT: open stems with no complement (`Nilikuwa nauliza`, `Nilikuwa nataka kujua`, `nataka kujua`, `nilikuwa nataka`, `nauliza`, `nilikuwa`, `ningetaka`, `naomba`, `I wanted to know`, `I wanted to know…`) including when they sit after phatic or backchannel. A dangling `kuhusu` / `about` with no object is still unfinished. Voice `unfinished` / `weak` still rejects the whole turn even if a later clause looks complete. The stem list rejects on its own when Voice omits the flag.  
- Non-actionable openers (`What else?`, how-are-you, `Namna gani`)  
- Pure backchannel / hear-again  
- Echo of the pack identity ask alone (`Je, naongea na {Name}?`, `Nya, unaongea na {Name}?`)  
- Raw first_forward text unless the same filter leaves an actionable ask  

### Write rules

1. `observeCallerTurn` must not set `goal.description` from rejected text.  
2. Goal is the last actionable ask after `nameConfirmed`. Before bind, a vaguer line does not replace a more specific ask. Unfinished turns never stamp a goal, even when Voice has not passed the flag yet.  
3. Hangup has one writer: `deriveCallSummary`. `calls.primary_intent`, `summary.primary_intent`, and the `Intent:` line are that object's `primaryIntent`. Resolution class still comes from `deriveCallResolution` on the same state.  
4. Transcript review, if it changes resolution/intent, rewrites that same spine (Intent line, brain_summary, column) under the same write lock as hangup so a late hangup merge cannot leave the column on one intent and the summary on another.  
5. `first_forward.first_turn` may store raw STT for ops; `bucket=first_turn_goal` / judge only if the goal filter leaves an actionable ask.

---

## 3. Unfinished import (Voice → Brain)

Voice already detects unfinished (`utteranceLooksIncomplete` / turn-end wait). The flush path must **pass** `unfinished` (and weak opening labels when present) into Brain observe — not drop the flag and hand raw text only.

Brain uses the label (plus local unfinished/stem filters) to reject goal promotion.

---

## 4. Fixture lock — HD_c05cdda9684d

Caller turns (ordered):

1. `Nilikuwa nauliza`  
2. `Eeh, unaongea na Alvin? Nilikuwa nauliza, I heard something left you didn't like.`  
3. `I had a request with you.`  
4. `Like, my previous request.`  
5. `What else?`  
6. `Uh, what aboutthe inquiry.`  
7. `Like, the dishwashing one. Do you remember?`

Assertions:

- After T1: `goal.description` null/rejected; summary must not contain `Goal: Nilikuwa nauliza`; first_forward not judged goal.  
- After identity ask + T2: `nameConfirmed === true`, `boundRole === 'primary'`. Pack confirm includes `Eeh`, `Yeah`, `Nya`, and `Nia` plus `unaongea na {Name}` / `naongea na {Name}`, with or without `?`, after `Je, naongea na {Name}?` or `Am I speaking with {Name}?`. A different echoed name does not bind. Bare yes before the ask does not bind.  
- Before bind: no agent line with open-request facts or vocative file name (except the identity ask).  
- After bind + file ask: file-read may speak open rows; NBA must not say name unconfirmed.  
- Hangup: `summary.primary_intent` agrees with `calls.primary_intent` and the `Intent:` line; Goal reflects dishwashing / previous-request enquiry — not unfinished STT.

HD_39c40ec3ad1f (same contracts): T1 `Mm-hm. Namna gani, Shy? Nilikuwa nataka kujua.` is not Goal, not the summary Goal line, and not `first_turn_goal`. T2 `Nya, unaongea na Alvin?` after `Am I speaking with Alvin?` sets `nameConfirmed`. T3 `Eeh, nilikuwa nataka kujua, ni services gani mna-offer?` becomes the goal (the services ask), not the T1 stem.

---

## 5. PR split

| PR | Lane | Scope |
| --- | --- | --- |
| **Brain PR1** | Brain | Goal/summary single writer; reject unfinished as goal; Kiswahili/pack confirm matchers; hangup+review spine alignment; HD fixture tests; land both product docs |
| **Voice thin** | Voice | Export unfinished (and weak) into observe; stop parallel identity flags; consume speak-gate / `nameConfirmed` |
| **Brain later** | Brain | Wait+tools hold rotation contract; brief rewrite (≤2k redacted) |

Staging test before merge. Do not ship another Voice-only mouth filter for one Kiswahili stem.

## 6. Name fold and owner lock (`BRAIN_NAME_FOLD`, Chief ruling 18 Oct 2026)

Flag: `BRAIN_NAME_FOLD`, on only when the value is exactly `on`. Off keeps every behaviour above. Fixture: HD_af5868852bc7 (Jirani staging, file `Alwyn`, alternate `Alvin`).

**Fold.** Two one-word names on one phone that are STT spellings of one name are ONE person, not a shared line. Code: `src/conversation/nameFold.js` (no imports; Desk mirrors it). Shared cases: `tests/fixtures/name-fold-cases.json`.

- Same first letter after the sound map, and either the same Kenyan-English sound key (ph/f/v/w, l/r, c/k/q, z/s, y/i, silent h after the first letter, double letters, trailing e/s), or, when both names have 5+ letters, key edit distance <= 2 with the same last key letter and the same consonant skeleton.
- Folds: Alwyn/Alvin, Brian/Bryan, Collins/Colin, Ann/Anne, Stephen/Steven, Mercy/Marcy, Jane/Jan, Daniel/Danielle.
- Stays two people: Alvin/Kevin, Mary/Martin, Joy/John, Grace/Gracie, Martin/Marvin, Kevin/Kelvin, Tom/Tim, Mark/Mary, any multi-word name ("Alvin" vs "Alvin Yegon").

**Where it applies (no row is rewritten).**

- `namesLikelySame` folds (so `distinctOtherPerson` and name binding fold); `{ fold: false }` is the strict form.
- `alternateIsAPerson` returns false for a folded alternate.
- `buildCallerMemoryCard`: folded alternates leave `alternateNames` and go to `nameVariants`; `sharedLine` counts only the others. A folded file is bound to that person from turn 1 (`identityBound`, `fileRole: primary`, `nameFolded`), so Brain never asks "Am I speaking with" for that pair. A truly different name keeps the shared line and its flow.
- Spelling: owner/caller lock (`contacts.name`), else the most-seen spelling (primary counts 1 + `metadata.name_seen_count`, each alternate row 1), else the primary. Ties keep the primary (`nameSpellingSource`).
- `mergeContactIdentity` (Brain copy): a folded incoming name is not added and does not re-spell the name. Stored folded alternates stay as history.

**Owner lock contract** (`contacts.metadata`; Desk `DESK_CONTACT_NAME_LOCK`, Voice `VOICE_CONTACT_NAME_LOCK`, Brain `BRAIN_NAME_FOLD`):

| Key | Meaning | Brain |
| --- | --- | --- |
| `single_person: true` | One person on this phone | Never shared; bound to `contacts.name` |
| `name_locked: { at, by: 'owner'\|'caller' }` | `contacts.name` is the spelling | Never shared; bound; merge never replaces or re-spells, adds no alternates |
| `alternate_names_dismissed: [{ name, at }]` | Owner removed these | Never on the card; merge never adds them back |

**First-call spelling read-back** (`src/conversation/nameReadBack.js`). A number with no name on file: once a name is captured and a save is ahead (booking, hold, order, cancellation, message, escalation), `determineNextBestAction` returns the speech act `slot: 'name_readback'` (with `name`) before anything else that turn. Code holds `caller.nameReadBack.status`: `pending` -> `asked` (only when the agent's last line read the name back as a question) -> `confirmed` (explicit yes, a matching spelling, or the caller's correction, which binds the corrected spelling) / `declined` (plain no) / `unanswered` (anything else, including "okay"/"sawa"). Offered twice without being spoken -> `skipped`. Never on a file that has a name or a lock; never twice on a call. On `confirmed`, `deriveCallSummary` adds `nameLock` and `persistCompletedCallContact` writes that spelling with `metadata.name_locked = { at, by: 'caller' }`. Prompt owns the words; the slot reason is a placeholder instruction.

Backfill report (read only): `node scripts/name-fold-backfill-report.js --sql`, run the SELECT, then pass the rows file. 18 Oct: staging 6 contacts with alternates, 1 folds (Jirani Alwyn/Alvin, stops being shared); prod 7 with alternates, 0 fold.

## Related

- [`BRAIN_TURN_CONTRACT.md`](../../reference/lanes/BRAIN_TURN_CONTRACT.md)  
- [`BRAIN.md`](../../reference/lanes/BRAIN.md)  
- [`CALLER_EXPERIENCE_EXCELLENCE.md`](CALLER_EXPERIENCE_EXCELLENCE.md)  
- [`CALLER_FILE_MODEL.md`](../product/CALLER_FILE_MODEL.md)  
