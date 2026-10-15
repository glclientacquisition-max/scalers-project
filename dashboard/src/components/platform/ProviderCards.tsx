"use client";

import { useState } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { BalanceFigure, CheckedTime, HealthStamp } from "@/components/platform/HealthStamp";
import { DetailPanel } from "@/components/platform/ProviderDetail";
import { STATE_WORD, type ProviderCard } from "@/lib/providerHealthModel";

const linkClass = "text-meta font-medium text-accent-deep underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function CardDetail({ card }: { card: ProviderCard }) {
  const rows: Array<[string, string]> = [
    ["Owner", card.owner],
    ["Environment", card.env === "prod" ? "Production" : "Staging"],
  ];
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <BalanceFigure amount={card.balanceAmount} unit={card.balanceUnit} />
          {card.runway ? <span className="mt-0.5 block text-meta tabular-nums text-ink-2">Runway {card.runway}</span> : null}
        </span>
        <HealthStamp state={card.state} />
      </div>
      <dl className="overflow-hidden rounded-2xl border border-hairline bg-surface px-4">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3 border-t border-hairline py-3 first:border-t-0">
            <dt className="w-24 shrink-0 text-meta text-ink-2">{k}</dt>
            <dd className="min-w-0 text-body text-ink">{v}</dd>
          </div>
        ))}
        <div className="flex gap-3 border-t border-hairline py-3">
          <dt className="w-24 shrink-0 text-meta text-ink-2">Checked</dt>
          <dd className="min-w-0 text-body text-ink">
            <CheckedTime iso={card.checkedAt} />
          </dd>
        </div>
      </dl>
      {card.error ? <p className="whitespace-pre-wrap text-body text-ink">{card.error}</p> : null}
      {card.scopes ? (
        <div>
          <p className="px-1 text-caption text-ink-3">Key scopes</p>
          <ul className="mt-1 divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-surface px-4">
            {card.scopes.map((s) => (
              <li key={s.scope} className="flex gap-3 py-3 text-body">
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
  const name = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="truncate">{card.name}</span>
      {card.shared ? <span className="shrink-0 text-caption text-ink-3">Shared</span> : null}
    </span>
  );
  const panel = (
    <DetailPanel open={open} onOpenChange={setOpen} title={card.name}>
      <CardDetail card={card} />
    </DetailPanel>
  );
  if (card.state === "ok") {
    // Green: one row inside the grouped "All good" list.
    return (
      <>
        <ListRow
          onOpen={() => setOpen(true)}
          title={name}
          preview={<BalanceFigure amount={card.balanceAmount} unit={card.balanceUnit} size="sm" />}
          stamp={<HealthStamp state="ok" />}
          when={<CheckedTime iso={card.checkedAt} />}
        />
        {panel}
      </>
    );
  }
  return (
    <li className="overflow-hidden rounded-2xl border border-hairline bg-surface">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block min-h-11 w-full min-w-0 px-5 pb-3 pt-4 text-start outline-none transition-colors duration-fast ease-out hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <span className="flex items-center gap-3">
          <span className="min-w-0 flex-1 text-body font-medium text-ink">{name}</span>
          <HealthStamp state={card.state} />
        </span>
        <span className="mt-3 block">
          <BalanceFigure amount={card.balanceAmount} unit={card.balanceUnit} />
        </span>
        {card.runway ? <span className="mt-0.5 block text-meta tabular-nums text-ink-2">Runway {card.runway}</span> : null}
        <span className="mt-3 block truncate text-meta text-ink">{card.error || STATE_WORD[card.state]}</span>
        {missingScopes ? (
          <span className="mt-1 block text-meta font-medium text-attention">
            {missingScopes} key {missingScopes === 1 ? "scope" : "scopes"} missing
          </span>
        ) : null}
      </button>
      <div className="flex items-baseline gap-3 border-t border-hairline px-5 py-3">
        <span className="min-w-0 flex-1 text-caption text-ink-3">
          Checked <CheckedTime iso={card.checkedAt} />
        </span>
        <a href={card.link.href} target="_blank" rel="noreferrer" className={linkClass}>
          {card.link.label}
        </a>
      </div>
      {panel}
    </li>
  );
}
