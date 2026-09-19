# WhatsApp Business frontend architecture

**Status:** Research spec for a Scalers chat client. Not shipped UI.  
**Lane:** Desk UI/UX  
**Law:** [`FRONTEND_CONSTITUTION.md`](./FRONTEND_CONSTITUTION.md), `.cursor/rules/scalers-design-ux.mdc`, [`design-system/MASTER.md`](./design-system/MASTER.md)  
**Pipe:** [`../specs/whatsapp-two-way.md`](../specs/whatsapp-two-way.md). SautiKit Cloud API. Chatwoot is not a native WhatsApp inbox.

This document tears down the **frontend** of WhatsApp and WhatsApp for Business, then binds those paradigms to a Cloud API client we own. It is not a reverse-engineered copy of WhatsApp’s private source. Claims about WhatsApp’s own apps are from observed client behavior, Meta Cloud API docs, and public multi-device writeups.

## 0. Three products, one design language

| Product | What the human uses | Where messages live | E2EE to the business |
| --- | --- | --- | --- |
| WhatsApp (consumer) | Phone + linked Web/Desktop | Device-local SQLite / IndexedDB, server fan-out | Yes (Signal) |
| WhatsApp Business **app** | Same client chrome plus labels, quick replies, away, catalog | Same local-first store | Yes |
| WhatsApp Business **Platform** (Cloud API) | You build the client | Your DB. Meta holds a copy for the WABA | No. HTTPS to the BSP |

Scalers is the third. We copy WhatsApp’s **interaction design** (list, ticks, 24h window, bubble stack). We do **not** copy Signal, WhatsApp’s Erlang stack, or Chatwoot’s native Cloud inbox. SautiKit remains the BSP. Desk remains Scalers-branded: filled primary `#005CCC`, ribbon `#0096FF`, glyph `#25D366` on white only.

Do not ship a second WhatsApp list on `/calls`. Voice work stays Inbox. Chat, when it ships, is one destination with this recipe.

---

## 1. Architectural and state management paradigm

### 1.1 WhatsApp’s own model (inferred)

WhatsApp is **local-first**. The UI never waits on the network to paint a send.

1. Writer appends a row to a local store (SQLite on mobile, IndexedDB on Web).
2. UI renders that row immediately (`pending` / clock).
3. A background sender (service worker or dedicated thread) uploads ciphertext or Cloud payload.
4. Server ack, device ack, then read ack mutate the same row in place.
5. Older history is paged from disk, not from RAM.

Linked devices (post multi-device) each keep their own store. The server fans out. Conflict rule: **server timestamp + monotonic message id win**. Deletes and edits are tombstones, not holes.

WhatsApp Web uses IndexedDB for chats, messages, and media refs. Blobs live in Cache Storage or object URLs that are revoked. Crypto and heavy search historically sit off the UI thread (Web Worker / native thread). The main thread owns layout, input, and a **hot window** of rows.

### 1.2 What scales to hundreds of live threads

Do not put the full message corpus in React state. Split four stores:

| Store | Location | Holds | Thread-safe rule |
| --- | --- | --- | --- |
| **Thread index** | Memory (Zustand / tiny store) | One record per chat: preview, unread, sort key, draft, window | Hundreds of rows. Fine on main thread. |
| **Open transcript** | Memory | Messages in the active chat, plus a small LRU of recently opened chats | Cap (e.g. 3 chats × 200 rows). Evict on unmount. |
| **Durable log** | IndexedDB (Dexie) or Postgres via RLS | All messages, outbox, receipts | Written from a worker or `queueMicrotask`. Never `JSON.stringify` the world into `localStorage`. |
| **Outbox** | IndexedDB + memory mirror | Unacked outbound | Drain serially per thread. Idempotent on `clientId`. |

**Main thread must not:** JSON-parse megabyte payloads, decode images, run full-text search, or hash media. Those go to a Worker. The worker posts structured clones (`{ type, threadId, messages[] }`), not React elements.

**Optimistic updates:** treat send as a state machine on the row, not as “insert then hope.”

```
queued → sending → sent → delivered → read
                ↘ failed (retry / expire)
```

The bubble identity is a **client id** (`cmsg_…`) until Meta returns `wamid`. Receipts patch by `clientId` then by `wamid`. Never insert a second bubble on ack.

**Eventual consistency for Cloud API:** Meta is source of truth for `wamid` and receipts. Local is source of truth for `queued` rows the server has not seen. Sync loop:

1. Load thread index from IDB (or first page from Supabase).
2. Subscribe (Realtime on `whatsapp_messages`, or poll `/whatsapp/events` side effects).
3. Merge by `(wamid || clientId)`. Last `serverTs` wins for status. Local `queued` wins until an ack arrives.
4. On reconnect, fetch `status` webhooks missed while offline (SautiKit does not store history; we persist). Replay outbox.

Kenya networks drop. The outbox is the product. A send that only exists in React will vanish on refresh.

### 1.3 Scalers binding (no E2EE worker)

Cloud API traffic is already plaintext to SautiKit. Skip a Signal worker. Keep:

- IndexedDB as a **cache and outbox**, not as the system of record.
- Supabase `whatsapp_threads` / `whatsapp_messages` as record (service role today; shop RLS in Phase 3).
- Realtime or voice-host fan-in for live rows.
- A single `ChatStore` module. Screens subscribe to selectors (`threadList`, `openMessages`). They never fetch in three components.

Offline: service worker caches the desk shell. Chat route reads IDB first, paints, then reconciles. Failed reconcile shows the last local preview, not a blank list.

### 1.4 Concurrency

| Technique | Use |
| --- | --- |
| Per-thread mutex on outbox drain | One in-flight send per chat. WhatsApp serializes too. |
| Snapshot isolation in the store | Reducers are pure. UI sees immutable snapshots. |
| `requestIdleCallback` for IDB compaction | Delete expired media refs, cap blob cache. |
| Shared Worker (optional later) | One outbox across desk tabs so two tabs do not double-send. |

---

## 2. Rendering performance

### 2.1 Virtualization (variable height)

A WhatsApp transcript is not a table. Rows are bubbles, date separators, unread rulers, system lines (“Labels: …”), product cards, and image blocks. Heights vary. Naive `map` of 50k nodes will jank and leak.

Required technique: **windowed list with measured heights**.

1. Keep an array of message ids in time order (append-only for the open chat).
2. Render only `overscan` items around the viewport (8–12).
3. Estimate height by type (`text: 44`, `image: 220`, `system: 28`, `product: 160`) on first insert.
4. After paint, `ResizeObserver` writes the real height into a `number[]` (or prefix-sum tree).
5. Scroll offset = sum of heights above the first visible index. Use a spacer `div` (or transform) so the scrollbar is honest.
6. **Stick to bottom** when the user is within ~48px of the end. If they scrolled up, new inbound does **not** jump. Show a “jump to latest” chip.
7. Load older pages when the top spacer enters view (`startIndex < 8`). Prepend ids. Restore scroll by adding the prepended pixel delta (`scrollTop += delta`). WhatsApp does this; without it the viewport jumps.

Libraries: `@tanstack/react-virtual` with `measureElement`. Do not use fixed-row `react-window` unless every row is the same height.

Images: decode off-screen (`<img decoding="async">`), intrinsic `width`/`height` to avoid layout shift, thumb first then full. Revoke `blob:` URLs on unmount.

### 2.2 DOM, GC, long sessions

WhatsApp Web can stay open for days. Leaks look like: detached listeners, unreleased blob URLs, growing receipt maps, React fibers for unmounted chats.

Rules:

- One transcript mount at a time on phone. Desktop split pane may keep the list virtualized and **one** open chat.
- Unmounting a chat **must** drop its message array from the LRU, abort in-flight media, revoke blobs, disconnect that thread’s Realtime channel.
- Event listeners on `window` (paste, drag, keydown) register once at the Chat route, not per bubble.
- Do not store JSX or `Date` objects in IndexedDB. Store ISO strings and primitives.
- Cap in-memory search indexes. Rebuild in a worker from IDB.
- `WeakMap` for DOM node → id if you measure cells. Let GC collect nodes the virtualizer recycled.
- Avoid anonymous inline objects in virtualized row props (`style={{}}` new every parent render). Memo the row on `id + status + bodyHash`.
- Images: one decoded bitmap per visible item. WhatsApp-quality clients use an LRU of ~32 decoded bitmaps.

Main-thread budget: input latency under 50ms (Doherty). A keystroke must not scan the message list. Draft state is a separate atom.

### 2.3 List of threads (left rail)

Same virtualization if the shop has thousands of chats. Preview is **one truncated line** (`deskPreviewClass`). Unread is a count or a dot, not a second paragraph. Sort key is `max(lastInboundAt, lastOutboundAt, lastLocalQueuedAt)` descending. Pin / label filters are client indexes over the thread store, not extra fetches.

---

## 3. WhatsApp for Business frontend architecture

The Business **app** adds a thin metadata layer on the same bubble UI. Cloud API exposes a richer, more structured set. The client must model both.

### 3.1 Specialized features (how the UI should treat them)

**Quick replies.** Named snippets with a shortcut (e.g. `/quote`). Not templates. They send as session `type=text` inside the 24h window. Store per-inbox. Picker: type `/` in the composer, filter by prefix, Enter sends. On phone, a 44px chip row above the composer for the top five. Do not hide them behind a settings essay.

**Message templates.** Cloud API only. Approved Meta templates for **originating** outside the window. Staff notify today uses `scalers_staff_alert` / `en` (first Active Utility). Kind names later. Composer (when chat ships): if `windowOpen === false`, the text field is disabled and the template picker is the primary control. Fill body parameters in a short form (`textarea rows={2}`). Preview the exact customer string before send. Do not ship a second `/whatsapp` list for this.

**Away / greeting / default reply.** These are **inbox automations**, not composer features. They fire on the server (voice host or a worker) so they still run when the owner’s laptop is shut. The frontend only edits the copy and the schedule. Away is one message. Greeting is first inbound in a quiet period. Default reply is a single auto-ack (Scalers already has `PLATFORM_WHATSAPP_ACK`). Show a system bubble in the transcript when an automation sent, so staff do not double-reply.

**Labels.** Business app: colored tags on **chats** (not on each bubble). Cloud API does not give Meta-side labels. We persist labels on `whatsapp_threads`. UI: filter chips on the thread list, a muted tag on the header of the open chat. Max ~20. Assignment is a muted ghost control, not a second primary.

**Catalog / products.** Interactive `product` / `product_list` messages. Render as a card inside the transcript (image, name, price, one CTA). Catalog management is a Business settings surface, not a card stack on the chat list. Sending a product is an attachment sheet from the composer (`+`), same hit as image.

**Buttons and lists.** Cloud API interactive replies. Render inbound button titles as the customer’s message text. Outbound: a compact button stack inside our bubble, 44px hits, one column.

**CTWA / ads referral.** First inbound may carry `referral`. Show one system line under the date: source name. Do not build an ads console in chat.

**24h customer-service window.** Derived from `lastInboundAt`. Banner above the composer when it will close within 2h. When closed, composer switches to templates. This is policy, not decoration.

**Multi-agent.** WhatsApp Business app is a weak multi-agent. Cloud API lets us assign. Assignment lives on the thread (`assigneeStaffId`). Header shows the person. Filter “Mine”. Chatwoot API inbox, if incorporated later, is this layer only. It does not own webhooks.

### 3.2 Thread schema (TypeScript)

Maps to `whatsapp_threads` / `whatsapp_messages` and adds business metadata the SQL can grow into jsonb without changing routing.

```ts
/** Meta Cloud message id. Stable once Meta acks. */
export type Wamid = string & { readonly __wamid: unique symbol };
/** Client-generated. Survives refresh until wamid arrives. */
export type ClientMsgId = string & { readonly __cmsg: unique symbol };

export type ChatIdentity = 'platform' | 'shop';

export type Receipt = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MsgKind =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'button'
  | 'interactive_list'
  | 'template'
  | 'product'
  | 'product_list'
  | 'system'
  | 'automation';

export type Direction = 'inbound' | 'outbound';

export type WaLabel = {
  id: string;
  name: string;
  /** Token only. Not WhatsApp's palette. */
  tone: 'ink' | 'lead' | 'ok' | 'warn' | 'brand';
};

export type QuickReply = {
  id: string;
  shortcut: string;
  body: string;
  inboxId: string;
};

export type TemplateParam = { type: 'text'; text: string };

export type TemplateRef = {
  name: string;
  language: string;
  bodyParams: TemplateParam[];
};

export type ProductRef = {
  catalogId: string;
  productRetailerId: string;
  title: string;
  priceText: string;
  imageUrl?: string;
};

export type AutomationKind = 'greeting' | 'away' | 'default_ack';

export type ChatContact = {
  waId: string;
  name: string | null;
  /** Last profile name Meta sent. Do not invent. */
};

export type WindowState = {
  lastInboundAt: string | null;
  /** 24h from last inbound. */
  openUntil: string | null;
  open: boolean;
};

export type ChatMessage = {
  id: ClientMsgId;
  wamid: Wamid | null;
  threadId: string;
  direction: Direction;
  kind: MsgKind;
  body: string;
  receipt: Receipt;
  error: string | null;
  createdAt: string;
  serverTs: string | null;
  replyToWamid: Wamid | null;
  template: TemplateRef | null;
  product: ProductRef | null;
  automation: AutomationKind | null;
  media: {
    url: string | null;
    mime: string | null;
    width: number | null;
    height: number | null;
    bytes: number | null;
  } | null;
};

export type ChatThread = {
  id: string;
  identity: ChatIdentity;
  phoneNumberId: string;
  sautikitNumberId: string | null;
  e164: string | null;
  contact: ChatContact;
  preview: string;
  unread: number;
  pinned: boolean;
  labels: WaLabel[];
  assigneeStaffId: string | null;
  window: WindowState;
  lastActivityAt: string;
  draft: string;
  typing: boolean;
};

export type ChatInboxConfig = {
  identity: ChatIdentity;
  phoneNumberId: string;
  greeting: string | null;
  away: { on: boolean; body: string } | null;
  defaultAck: string | null;
  quickReplies: QuickReply[];
  templates: TemplateRef[];
  labels: WaLabel[];
};

export type ThreadIndexState = {
  threads: ChatThread[];
  filter: 'all' | 'unread' | 'mine' | string;
  query: string;
};

export type OpenChatState = {
  threadId: string | null;
  messages: ChatMessage[];
  hasOlder: boolean;
  stickToBottom: boolean;
};

export type OutboxItem = {
  clientId: ClientMsgId;
  threadId: string;
  payload: unknown;
  attempts: number;
  nextAttemptAt: string;
};
```

### 3.3 Merge rules

```ts
function mergeMessage(a: ChatMessage, b: ChatMessage): ChatMessage {
  const receiptRank: Record<Receipt, number> = {
    queued: 0,
    sending: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    failed: 0,
  };
  return {
    ...a,
    ...b,
    id: a.id,
    wamid: b.wamid ?? a.wamid,
    receipt:
      receiptRank[b.receipt] >= receiptRank[a.receipt] ? b.receipt : a.receipt,
    body: b.body || a.body,
  };
}
```

---

## 4. UI/UX and design system

### 4.1 WhatsApp’s language (what to steal)

| Principle | WhatsApp | Scalers desk |
| --- | --- | --- |
| List row | Avatar, name, one preview, time | `DeskRowHit`: `RowIdentity`, `deskPreviewClass`, stamp. No Open column. |
| Unread | Bold name + count | `deskRowWeightClass` + `RowStateDot` |
| Transcript | Inbound left, outbound right, date stickers | Same. System lines centered, `text-xs text-ink-soft` |
| Ticks | Clock / one / two / blue | Clock = queued. One = sent. Two = delivered. Brand-blue pair = read. Never green ticks (WhatsApp blue ticks are read; we use `#005CCC`) |
| Composer | Sticky bottom, 44px send | Dock send to the field. Filled `#005CCC` send. `textarea rows={2}` auto-expand. |
| Split | Chats \| transcript on desktop | `lg+` two panes. Below `lg`, list **or** transcript, not a third stack. |
| Feedback | Bubble appears before radio | Optimistic row. `pendingSpinnerClass` on send only if drain is slow (>400ms) |

Typography in WhatsApp is system UI, 16px body in bubbles, 13px meta. Scalers: DM Sans body, `text-sm` in lists, bubble body `text-[15px] leading-5` (readable on mid-range Android). Meta time `text-xs text-ink-soft`. No Sora inside bubbles.

Layout hierarchy for a Chat route:

1. **Thread list** (left / full on phone): filters, search, virtual rows.
2. **Transcript header**: name, labels, window chip, muted assign.
3. **Virtual transcript**.
4. **Composer dock**: attachments, quick replies, input, send.

Tap the row to open. No View column. Destructive archive is a ghost in the header menu, not a list verb.

### 4.2 Accessibility

- Thread list is a `listbox` or a table with one action dock. Transcript is a `log` with `aria-live="polite"` **only** for inbound while the transcript is focused. Do not live-announce every tick (that would shout).
- Send is a 44×44 control. Composer is `aria-label="Message"`.
- Contrast: ink `#0A192F` on canvas. Do not put `#0096FF` on white for body. Outbound bubble fill may be `accent-soft`; inbound `surface` with `border-line`.
- Reduced motion: ticks do not bounce. Stick-to-bottom is instant. `prefers-reduced-motion` kills land wash.
- Keyboard: `j`/`k` or arrows move threads. `Enter` opens. `Esc` back to list on phone. Composer keeps normal text editing.

### 4.3 Low-end devices and poor networks (Kenya)

| Condition | Degrade |
| --- | --- |
| Android Go / 2 GB | Cap decoded images at 3. No blur hashes. Disable sticker picker. |
| 2G / flaky | Outbox + local preview. Hide media until tap (“Tap to load”). Templates still send as text payload. |
| Offline | Composer stays. Rows show clock. Banner: `Waiting for network`. Not a modal. |
| Reduce data | Auto-download images off. Prefetch next page of **ids** only. |
| Long session | LRU chats = 1 on phone. Virtualizer overscan 6. |

Empty and error: `deskEmptyClass` title plus one link. Never a marketing paragraph. Failed send: muted Retry on the bubble.

### 4.4 Motion (desk verbs only)

Pending on send drain. Live ping on a new inbound thread in the list. Land wash on a thread that appears while watching. Press on send. No Lottie, no bubble pop, no typing-dot novelty beyond a three-dot `text-ink-soft` when `typing` is true (Cloud API typing is optional; skip until the pipe has it).

---

## 5. Optimistic send + virtualization (React)

Lightweight sketch. Not a shipped component. Heights are measured. Send does not block on `fetch`.

```tsx
import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

type Props = {
  messages: ChatMessage[];
  stickToBottom: boolean;
  onSend: (body: string) => void;
  onLoadOlder: () => void;
};

export function Transcript({ messages, stickToBottom, onSend, onLoadOlder }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => estimateBubbleHeight(messages[i]),
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 10,
    getItemKey: (i) => messages[i].id,
  });

  const onScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    if (el.scrollTop < 80) onLoadOlder();
  }, [onLoadOlder]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={onScroll}
      >
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((row) => {
            const msg = messages[row.index];
            return (
              <div
                key={msg.id}
                data-index={row.index}
                ref={virtualizer.measureElement}
                className="absolute left-0 top-0 w-full px-4 py-1"
                style={{ transform: `translateY(${row.start}px)` }}
              >
                <Bubble msg={msg} />
              </div>
            );
          })}
        </div>
      </div>
      <Composer
        onSubmit={(body) => {
          onSend(body);
          if (stickToBottom) {
            requestAnimationFrame(() =>
              virtualizer.scrollToIndex(messages.length, { align: 'end' })
            );
          }
        }}
      />
    </div>
  );
}

/** Store action: local row first, network later. */
export function queueOutbound(thread: ChatThread, body: string): ChatMessage {
  const id = crypto.randomUUID() as ClientMsgId;
  const row: ChatMessage = {
    id,
    wamid: null,
    threadId: thread.id,
    direction: 'outbound',
    kind: 'text',
    body,
    receipt: 'queued',
    error: null,
    createdAt: new Date().toISOString(),
    serverTs: null,
    replyToWamid: null,
    template: null,
    product: null,
    automation: null,
    media: null,
  };
  appendLocal(row);
  enqueueOutbox({ clientId: id, threadId: thread.id, payload: { to: thread.contact.waId, body }, attempts: 0, nextAttemptAt: new Date().toISOString() });
  return row;
}
```

Drain (pseudo):

```
for item in outbox where nextAttemptAt <= now, grouped by threadId:
  set receipt = sending
  POST SautiKit /v1/whatsapp/messages  (or desk API that does)
  on 200/202: patch wamid, receipt = sent
  on 4xx window closed: receipt = failed, composer → templates
  on 5xx/network: attempts++, backoff, keep bubble
```

---

## 6. What we will not copy

- WhatsApp green as the filled primary. Recognition is the glyph. Task color is Scalers navy-blue.
- Native Chatwoot / Chatwoot Embedded Signup on this WABA. That overrides the webhook.
- A second chat UI for the same `whatsapp_threads` rows.
- Emoji-only empty states, hero cards, or stacked padded conversation cards.
- Em dashes in any owner-facing string.
- Live typing, read receipts **to the customer**, or presence, until the pipe supports them. Ticks are for **our** outbound only.
- WhatsApp Calling UI (Meta 138015). Parked.

---

## 7. Ship order

1. Thread list + transcript on platform identity only (`phone_number_id` `1237105982825100`). Optimistic text. Ticks from status webhooks.
2. Window banner + template composer when closed.
3. Quick replies and labels (local metadata).
4. Media thumbs + virtualizer measurement.
5. IndexedDB outbox (after the happy path is live on Railway).
6. Shop inboxes (Phase 3) reuse this client, keyed by `phoneNumberId`.
7. Optional Chatwoot API inbox as the multi-agent header, same schema.

Until step 1 ships, `/calls` WhatsApp remains `wa.me` follow-up per [`design-system/pages/calls.md`](./design-system/pages/calls.md).
