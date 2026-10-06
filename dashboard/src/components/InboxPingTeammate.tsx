"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellAlertIcon } from "@heroicons/react/24/outline";
import { pingTeammateAction } from "@/app/(desk)/calls/escalateActions";
import { DeskSelect } from "@/components/ui/DeskSelect";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Sheet } from "@/components/ui/Sheet";

export type InboxPingPerson = {
  name: string;
  role: string;
  phone: string;
  email?: string;
};

export function InboxPingTeammate({
  callId,
  people,
  archived,
  variant = "block",
}: {
  callId: string;
  people: InboxPingPerson[];
  archived: boolean;
  variant?: "block" | "dock";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [picked, setPicked] = useState(people[0]?.name || "");
  const [open, setOpen] = useState(false);
  const one = people.length === 1 ? people[0] : null;
  const hidden = archived || people.length === 0;

  function run(name: string) {
    if (pending) return;
    setError(null);
    setOpen(false);
    setPending(true);
    void (async () => {
      const res = await pingTeammateAction({ callId, teammateName: name });
      setPending(false);
      if (res.line) setLine(res.line);
      if (res.error && res.error !== res.line) setError(res.error);
      else if (!res.ok && !res.failed) setError(res.error || "Could not ping.");
      router.refresh();
    })();
  }

  if (hidden) return null;

  if (variant === "dock") {
    const hint = one ? `Ping ${one.name}` : "Ping teammate";
    return (
      <div className="flex w-16 flex-col items-center gap-1">
        <IconButton
          label={pending ? "Pinging" : hint}
          size="sm"
          pending={pending}
          onClick={() => {
            if (one) {
              run(one.name);
              return;
            }
            setError(null);
            setOpen(true);
          }}
        >
          <BellAlertIcon aria-hidden="true" />
        </IconButton>
        <span className="text-caption font-medium leading-none text-ink-2">Ping</span>
        <Sheet
          open={open}
          onOpenChange={(next) => {
            if (!next && pending) return;
            setOpen(next);
          }}
          title="Ping teammate"
          description="Notify one Escalate person on this ticket."
        >
          <div className="flex flex-col gap-1">
            {people.map((person) => (
              <Button
                key={`${person.name}-${person.phone}`}
                variant="ghost"
                size="md"
                block
                disabled={pending}
                onClick={() => run(person.name)}
              >
                {pending ? "Pinging" : person.name}
                {person.role ? ` (${person.role})` : ""}
              </Button>
            ))}
          </div>
        </Sheet>
        {line ? <p className="max-w-[6.5rem] text-center text-caption text-ink-2 [overflow-wrap:anywhere]">{line}</p> : null}
        {error ? (
          <p className="max-w-[6.5rem] text-center text-caption text-attention [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {one ? (
        <Button
          type="button"
          variant="ghost"
          size="md"
          block
          pending={pending}
          onClick={() => run(one.name)}
        >
          {pending ? "Pinging" : `Ping ${one.name}`}
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`ping-teammate-${callId}`}>
            Teammate
          </label>
          <DeskSelect
            id={`ping-teammate-${callId}`}
            aria-label="Teammate"
            value={picked}
            disabled={pending}
            className="min-h-12 min-w-0 flex-1 rounded-xl border border-hairline bg-surface px-3 text-body text-ink focus:outline-none focus:ring-2 focus:ring-brand"
            options={people.map((person) => ({
              value: person.name,
              label: person.role
                ? `${person.name} (${person.role})`
                : person.name,
            }))}
            onChange={setPicked}
          />
          <Button
            type="button"
            variant="ghost"
            size="md"
            disabled={pending || !picked}
            pending={pending}
            onClick={() => run(picked)}
          >
            {pending ? "Pinging" : "Ping teammate"}
          </Button>
        </div>
      )}
      {line ? <p className="text-meta text-ink-2 [overflow-wrap:anywhere]">{line}</p> : null}
      {error ? (
        <p className="text-meta text-attention [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
