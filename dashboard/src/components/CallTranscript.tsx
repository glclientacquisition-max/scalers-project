"use client";

import { useMemo, useState } from "react";
import { btnGhost } from "@/components/ui/deskChrome";
import {
  buildCallTranscriptStream,
  type TranscriptFactItem,
  type TranscriptSpeechItem,
  type TranscriptStreamItem,
} from "@/lib/callTranscriptStream";
import type { TranscriptRow } from "@/lib/supabase";

const PREVIEW_TURNS = 3;

function SpeechBubble({
  item,
  lead,
}: {
  item: TranscriptSpeechItem;
  lead: boolean;
}) {
  const isCaller = item.speaker === "caller";
  const who = isCaller ? "Caller" : "Receptionist";
  return (
    <div
      className={[
        "flex px-1",
        isCaller ? "justify-start" : "justify-end",
        lead ? "" : item.clustered ? "mt-1" : "mt-3",
      ].join(" ")}
    >
      <div
        role="group"
        aria-label={who}
        className={[
          "max-w-[85%] px-3 py-2 sm:max-w-[75%]",
          isCaller ? "bg-bubble-caller text-ink" : "bg-surface-muted/70 text-ink",
          isCaller
            ? item.tail
              ? "rounded-2xl rounded-bl-md"
              : "rounded-2xl"
            : item.tail
              ? "rounded-2xl rounded-br-md"
              : "rounded-2xl",
        ].join(" ")}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
          {item.text}
        </p>
        {item.stamp ? (
          <p className="mt-1 text-[11px] text-ink-soft">{item.stamp}</p>
        ) : null}
      </div>
    </div>
  );
}

function FactLine({ item, lead }: { item: TranscriptFactItem; lead: boolean }) {
  return (
    <p
      data-transcript-fact=""
      className={[
        "px-2 text-center text-xs text-ink-soft [overflow-wrap:anywhere]",
        lead ? "" : "mt-3",
      ].join(" ")}
    >
      {item.text}
    </p>
  );
}

function StreamItemView({
  item,
  lead,
}: {
  item: TranscriptStreamItem;
  lead: boolean;
}) {
  if (item.kind === "fact") return <FactLine item={item} lead={lead} />;
  return <SpeechBubble item={item} lead={lead} />;
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
  const stream = useMemo(() => buildCallTranscriptStream(turns), [turns]);
  const canCollapse = !thread && stream.length > PREVIEW_TURNS;
  const visible =
    thread || expanded || !canCollapse ? stream : stream.slice(-PREVIEW_TURNS);
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
            ? ""
            : "relative mt-4 rounded-2xl border border-line bg-surface px-2 py-4 sm:px-4"
        }
      >
        {stream.length === 0 ? (
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
            <div data-transcript-stream="" className="flex flex-col">
              {visible.map((item, index) => (
                <StreamItemView key={item.id} item={item} lead={index === 0} />
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
