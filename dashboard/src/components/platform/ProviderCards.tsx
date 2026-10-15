"use client";

import { useState } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { CheckedTime, HealthStamp } from "@/components/platform/HealthStamp";
import { DetailPanel } from "@/components/platform/ProviderDetail";
import { STATE_WORD, type ProviderCard } from "@/lib/providerHealthModel";

const linkClass = "text-meta font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function CardDetail({ card }: { card: ProviderCard }) {
  const rows: Array<[string, string]> = [
    ["Status", STATE_WORD[card.state]],
    ["Balance", card.balance],
    ["Runway", card.runway || "n/a"],
    ["Owner", card.owner],
  ];
  return (
    <div className="space-y-4">
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 border-t border-hairline py-2 first:border-t-0">
            <dt className="w-24 shrink-0 text-meta text-ink-2">{k}</dt>
            <dd className="min-w-0 text-body text-ink">{v}</dd>
          </div>
        ))}
        <div className="flex gap-3 border-t border-hairline py-2">
          <dt className="w-24 shrink-0 text-meta text-ink-2">Checked</dt>
          <dd className="min-w-0 text-body text-ink">
            <CheckedTime iso={card.checkedAt} />
          </dd>
        </div>
      </dl>
      {card.error ? <p className="whitespace-pre-wrap text-body text-ink">{card.error}</p> : null}
      {card.scopes ? (
        <div>
          <p className="text-meta text-ink-2">Key scopes</p>
          <ul className="mt-1">
            {card.scopes.map((s) => (
              <li key={s.scope} className="flex gap-3 py-1 text-body">
                <span className="min-w-0 flex-1 text-ink">{s.scope}</span>
                <span className={s.ok ? "text-ok" : "font-semibold text-attention"}>{s.ok ? "OK" : "Missing"}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.shared ? <p className="text-meta text-ink-2">Shared: one account serves production and staging. Top up once.</p> : null}
      <a href={card.link.href} target="_blank" rel="noreferrer" className={linkClass}>
        {card.link.label}
      </a>
    </div>
  );
}

export function ProviderCardView({ card }: { card: ProviderCard }) {
  const [open, setOpen] = useState(false);
  const missingScopes = (card.scopes || []).filter((s) => !s.ok).length;
  const title = (
    <span className="flex items-baseline gap-2">
      <span className="truncate">{card.name}</span>
      {card.shared ? <span className="shrink-0 text-caption text-ink-3">shared</span> : null}
    </span>
  );
  const panel = (
    <DetailPanel open={open} onOpenChange={setOpen} title={card.name}>
      <CardDetail card={card} />
    </DetailPanel>
  );
  if (card.state === "ok") {
    // Green cards collapse to one line.
    return (
      <>
        <ListRow
          className="overflow-hidden rounded-2xl border border-hairline"
          onOpen={() => setOpen(true)}
          title={title}
          stamp={<HealthStamp state="ok" />}
          when={<CheckedTime iso={card.checkedAt} />}
        />
        {panel}
      </>
    );
  }
  return (
    <li className="rounded-2xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full min-w-0 px-4 py-3 text-start outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <span className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 text-body font-medium text-ink">{title}</span>
          <HealthStamp state={card.state} />
        </span>
        <span className="mt-1 block truncate text-meta text-ink-2">{card.error || STATE_WORD[card.state]}</span>
        <span className="mt-1 flex flex-wrap gap-x-4 text-meta text-ink-2">
          <span>{card.balance}</span>
          {card.runway ? <span>Runway {card.runway}</span> : null}
          {missingScopes ? <span className="text-attention">{missingScopes} scope(s) missing</span> : null}
          <span>
            Checked <CheckedTime iso={card.checkedAt} />
          </span>
        </span>
      </button>
      <div className="px-4 pb-3">
        <a href={card.link.href} target="_blank" rel="noreferrer" className={linkClass}>
          {card.link.label}
        </a>
      </div>
      {panel}
    </li>
  );
}
