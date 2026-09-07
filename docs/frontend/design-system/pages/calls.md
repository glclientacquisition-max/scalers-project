# Inbox

**Route:** `/calls`  
**Job:** One work surface. Signal stamps name the next action: Confirm visit, Visit, Hold, Order, Human asked, Missed, Answered.

**Chrome:** Title Inbox (matches nav). Caption is a briefing (`3 need you. 1 to confirm.`), not a raw count. Search stays here.

Filters: Needs you / Holds / Jobs / Human / Answered / All.

Work that needs the owner sorts above answered rows. Urgent above the rest.

Columns:
- Mixed filters: Work / Needed / When / Action. When is Today / Yesterday / weekday.
- Holds: Item / Who / Needed. Verb **Done**. Transcript is **Call**.
- Jobs: Visit / Who / Place. Verb **Confirm**. Transcript is **Call**.

Voice rows still **Open** the transcript.

`/requests` → `?purpose=hold`. `/appointments` → `?purpose=job`.
