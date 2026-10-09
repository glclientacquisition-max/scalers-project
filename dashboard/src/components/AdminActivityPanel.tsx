"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChoiceSheet } from "@/components/ui/ChoiceSheet";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { activityHref, type ActivityItem } from "@/lib/adminActivityModel";

const ALL = "all";

/**
 * Every admin write, newest first: what, which business, who, when, and why.
 * Filters are bottom-sheet pickers; a row opens its before and after in a Sheet.
 */
export function AdminActivityPanel({
  items,
  businesses,
  actors,
  business,
  actor,
  limit,
}: {
  items: ActivityItem[];
  businesses: { id: string; name: string }[];
  actors: string[];
  business: string | null;
  actor: string | null;
  limit: number;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = items.find((item) => item.id === openId) || null;
  const go = (next: { business?: string | null; actor?: string | null }) =>
    router.replace(activityHref({ business, actor, ...next }), { scroll: false });

  const businessOptions = [
    { value: ALL, label: "All businesses" },
    ...businesses.map((b) => ({ value: b.id, label: b.name })),
  ];
  const actorOptions = [{ value: ALL, label: "Everyone" }, ...actors.map((a) => ({ value: a, label: a }))];
  const filtered = Boolean(business || actor);

  return (
    <div className="space-y-6">
      <section aria-labelledby="activity-filters">
        <h1 id="activity-filters" className="px-4 text-caption text-ink-3">
          Activity
        </h1>
        <ul className="divide-y divide-hairline bg-surface">
          <li>
            <ChoiceSheet
              title="Business"
              rowLabel="Business"
              value={business || ALL}
              options={businessOptions}
              onChange={(value) => go({ business: value === ALL ? null : value })}
              theme="admin"
            />
          </li>
          <li>
            <ChoiceSheet
              title="Operator"
              rowLabel="Operator"
              value={actor || ALL}
              options={actorOptions}
              onChange={(value) => go({ actor: value === ALL ? null : value })}
              theme="admin"
            />
          </li>
        </ul>
      </section>

      <section aria-label="Admin actions">
        {items.length === 0 ? (
          <Empty
            title={filtered ? "Nothing for this filter." : "No admin actions yet."}
            line={
              filtered
                ? "Try all businesses or everyone."
                : "Number, package, archive, and settings changes show up here as they happen."
            }
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((item) => (
              <ListRow
                key={item.id}
                title={item.title}
                preview={item.preview || undefined}
                when={item.when}
                onOpen={() => setOpenId(item.id)}
              />
            ))}
          </ul>
        )}
        {items.length >= limit ? (
          <p className="px-4 pt-2 text-meta text-ink-3">Newest {limit}. Filter by business or operator to see older ones.</p>
        ) : null}
      </section>

      <Sheet
        open={Boolean(open)}
        onOpenChange={(next) => {
          if (!next) setOpenId(null);
        }}
        title={open?.title || "Action"}
        description={open ? `${open.when} EAT` : undefined}
        theme="admin"
      >
        {open ? (
          <div className="space-y-5">
            <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
              <ListRow title="Who" preview={open.actor} />
              {open.business ? (
                <ListRow
                  title="Business"
                  preview={open.business}
                  href={open.businessId ? `/admin/businesses#biz-${open.businessId}` : undefined}
                />
              ) : null}
              {open.reason ? <ListRow title="Why" preview={open.reason} /> : null}
            </ul>
            {open.changes.length ? (
              <section aria-labelledby="activity-changes">
                <h2 id="activity-changes" className="text-caption text-ink-3">
                  Before and after
                </h2>
                <dl className="mt-2 space-y-3">
                  {open.changes.map((line) => (
                    <div key={line.field} className="min-w-0">
                      <dt className="text-meta font-medium text-ink">{line.field}</dt>
                      <dd className="mt-0.5 break-words text-meta text-ink-2">
                        {line.before ? (
                          <>
                            <span className="text-ink-3 line-through">{line.before}</span>
                            <span aria-hidden="true"> → </span>
                            <span className="sr-only"> changed to </span>
                          </>
                        ) : null}
                        <span>{line.after}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ) : (
              <p className="text-meta text-ink-3">No before and after recorded for this action.</p>
            )}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
