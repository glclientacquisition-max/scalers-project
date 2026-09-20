"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { pingTeammateAction } from "@/app/(desk)/calls/escalateActions";
import { btnGhost, focusRingVisible, pendingSpinnerClass } from "@/components/ui/deskChrome";

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
}: {
  callId: string;
  people: InboxPingPerson[];
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<string | null>(null);
  const [picked, setPicked] = useState(people[0]?.name || "");

  if (archived || people.length === 0) return null;

  const one = people.length === 1 ? people[0] : null;

  function run(name: string) {
    setError(null);
    startTransition(async () => {
      const res = await pingTeammateAction({ callId, teammateName: name });
      if (res.line) setLine(res.line);
      if (res.error && res.error !== res.line) setError(res.error);
      else if (!res.ok && !res.failed) setError(res.error || "Could not ping.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {one ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(one.name)}
          className={`${btnGhost} w-full gap-2`}
        >
          {pending ? <span className={pendingSpinnerClass} aria-hidden="true" /> : null}
          {pending ? "Pinging" : `Ping ${one.name}`}
        </button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="sr-only" htmlFor={`ping-teammate-${callId}`}>
            Teammate
          </label>
          <select
            id={`ping-teammate-${callId}`}
            value={picked}
            disabled={pending}
            onChange={(event) => setPicked(event.target.value)}
            className={`min-h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-ink ${focusRingVisible} focus:outline-none focus:ring-2 focus:ring-[#0096FF]`}
          >
            {people.map((person) => (
              <option key={`${person.name}-${person.phone}`} value={person.name}>
                {person.name}
                {person.role ? ` (${person.role})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !picked}
            onClick={() => run(picked)}
            className={`${btnGhost} shrink-0 gap-2`}
          >
            {pending ? <span className={pendingSpinnerClass} aria-hidden="true" /> : null}
            {pending ? "Pinging" : "Ping teammate"}
          </button>
        </div>
      )}
      {line ? <p className="text-xs text-ink-soft [overflow-wrap:anywhere]">{line}</p> : null}
      {error ? (
        <p className="text-xs text-warn [overflow-wrap:anywhere]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
