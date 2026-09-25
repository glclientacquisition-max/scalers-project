---
name: no-ai-slop
description: Cut AI writing tells from desk copy, empty states, agent docs, and drafts. Use when editing UI strings, READMEs, specs, or when the user says slop, slopchi, unslop, humanize, or asks if a draft reads as AI. Do not add a customer-facing chatbot.
---

# No AI slop (Scalers)

Sources: [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) (MIT) plus [cursor/plugins unslop](https://github.com/cursor/plugins/blob/main/pstack/skills/unslop/SKILL.md). Wired for Kenya desk copy. Not a product chat.

Two jobs:

**Edit (default).** Minimum effective edit. Return the draft plus What changed.

**Detect.** Name each pattern, quote the line, give the fix in a few words. Do not score. Do not guess whether a model wrote it.

If no draft is present, ask for the text. For desk UI, audience is the owner at 08:00 EAT. Format is a label, empty state, or table chrome.

## Desk copy (stricter)

Constitution wins. Labels are verbs or nouns the owner already knows. No instructional subtitle. No em dash or en dash. No "Train your receptionist in short steps."

WhatsApp-class list preview: identity plus one ellipsis line. Full hangup copy stays on the record.

Empty state names the next action. Example that is allowed: `No calls. Place a test call.` Example that is not: `You're all caught up. That's it. That's the whole inbox.`

Do not invent claims, stats, or a second voice for the receptionist. Brain lane owns spoken prompt copy.

After an edit, run [`eval.md`](eval.md).

## Patterns to cut

**Binary contrast.** "It's not X. It's Y." State Y.

**Throat-clearing.** "Here's the thing," "Let me be clear," "I'll be honest."

**Faux insight.** "What nobody tells you," "The part everyone misses."

**Colon reveal.** "The best part: it learns." Write a plain sentence. Colons stay for lists and labels.

**Superficial -ing.** "highlighting the team's commitment." Name the mechanism.

**Importance puff.** "marks a pivotal moment," "a testament to."

**Weasel.** "experts agree," "studies show." Name the source or cut.

**Synonym cycling.** Pick Inbox or Work. Do not rotate to queue, stream, then feed.

**Negative listing.** "Not a dashboard. Not a chatbot. A desk." Just say desk.

**Dramatic fragments.** "That's it. That's the whole thing."

**Chatbot residue.** "I hope this helps!", "Of course!", "Great question!"

**Filler.** "In order to" -> "To". "It is important to note that" deletes.

**AI vocabulary.** delve, leverage, utilize, facilitate, empower, streamline, robust, cutting-edge, tapestry, realm, pivotal, showcase, testament, vibrant, supercharge, harness.

**Em dash.** None in UI strings, placeholders, or empty states. Agent docs: prefer a period or a comma. Do not swap in an en dash.

**Say what it does.** "the database stays close at hand" dies. "`.toSQL()` returns the string sent to the database" lives. If the sentence could move to another product unchanged, cut it.

## Visual chrome (from the same slop family)

These are product tells, not a second theme. Flag them. Do not restyle onto Inter, indigo, or glass.

Purple or cream-serif-terracotta defaults. Gradient headlines. Nested cards where a table belongs. Badge spam. Glowing dots beyond `LivePing`. Invented stat rows. Kickers over every heading.

Brand ribbon `#0096FF` and primary `#005CCC` stay.

## Workflow

1. Read the whole draft.
2. Name the point and the voice to keep.
3. Detect: report and stop. Edit: change the least, then check `eval.md`.
4. Output the full draft and What changed.

Leave `writing-for-agents` in charge of skill and `AGENTS.md` packaging. Use this skill for the prose those docs and the desk will show a human.
