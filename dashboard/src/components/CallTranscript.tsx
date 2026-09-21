"use client";

import { useState } from "react";
import { btnGhost } from "@/components/ui/deskChrome";
import { plainOwnerCopy } from "@/lib/deskTicketChat";
import type { TranscriptRow } from "@/lib/supabase";

const PREVIEW_TURNS = 3;

function ChatBubble({ turn }: { turn: TranscriptRow }) {
  const speaker = String(turn.speaker || "").toLowerCase();
  const isCaller = speaker === "caller";
  const isSystem = speaker === "system";

  const copy = plainOwnerCopy(turn.text_content);

  if (isSystem) {
    return (
      <div className="flex justify-center px-2">
        <p className="max-w-[85%] rounded-full bg-surface-muted/80 px-4 py-1.5 text-center text-xs text-ink-soft [overflow-wrap:anywhere]">
          {copy}
        </p>
      </div>
    );
  }

  return (
    <div className={["flex px-1", isCaller ? "justify-start" : "justify-end"].join(" ")}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 sm:max-w-[75%]",
          isCaller
            ? "rounded-bl-md bg-bubble-caller text-ink"
            : "rounded-br-md bg-surface-muted/90 text-ink",
        ].join(" ")}
      >
        <p
          className={[
            "text-[11px] font-medium uppercase tracking-wide",
            isCaller ? "text-bubble-caller-ink" : "text-ink-soft",
          ].join(" ")}
        >
          {isCaller ? "Caller" : "Receptionist"}
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
          {copy}
        </p>
      </div>
    </div>
  );
}

export function CallTranscript({
  turns,
  mode = "preview",
}: {
  turns: TranscriptRow[];
  mode?: "preview" | "thread";
}) {
  const [expanded, setExpanded] = useState(false);
  const thread = mode === "thread";
  const canCollapse = !thread && turns.length > PREVIEW_TURNS;
  const visible =
    thread || expanded || !canCollapse ? turns : turns.slice(-PREVIEW_TURNS);
  const faded = canCollapse && !expanded;

  return (
    <section>
      {thread ? null : (
        <h2 className="font-display text-2xl tracking-tight text-ink">
          Conversation
        </h2>
      )}
      <div
        className={
          thread
            ? "space-y-2.5"
            : "relative mt-4 rounded-2xl border border-line bg-surface px-2 py-4 sm:px-4"
        }
      >
        {turns.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-soft">
            No conversation.
          </p>
        ) : (
          <>
            {faded ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-16 rounded-t-2xl bg-gradient-to-b from-surface to-transparent"
              />
            ) : null}
            <div className="space-y-2.5">
              {visible.map((turn) => (
                <ChatBubble key={turn.id} turn={turn} />
              ))}
            </div>
          </>
        )}
      </div>
      {canCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className={`${btnGhost} mx-auto mt-3 w-full max-w-lg`}
        >
          {expanded ? "Hide conversation" : "View full conversation"}
        </button>
      ) : null}
    </section>
  );
}
