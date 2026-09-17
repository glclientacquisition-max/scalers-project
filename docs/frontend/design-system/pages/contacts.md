# Contacts

**Route:** `/contacts`  
**Job:** Named callers. Not a CRM.

**Filters:** Same `FilterTabs` as Inbox. Do not restyle this as chips or a second tab dialect.

**Row:** Same recipe as Inbox. Tap the row to open the contact. No Open column. Last reason is one truncated line (`deskPreviewClass`). The four-block summary lives on the person file and the call.

**Detail:** `/contacts/[id]`. Notes left. Timeline right. Tap a timeline row that has a call to open the conversation. No Call column.

Identity is tenant + E.164 phone. The fifth call from the same number is the same contact. Last contact is the newest call. Last reason is the same hangup one-liner Inbox uses for that call. The Want card on the person file is the four-block summary, not the list line.
