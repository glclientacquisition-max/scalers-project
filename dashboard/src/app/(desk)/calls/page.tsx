import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { InboxToolbar } from "@/components/InboxToolbar";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { callsHref, sanitizeSearchQuery } from "@/lib/callsTriage";
import { loadInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";
import {
  countInboxPurposes,
  inboxCaption,
  itemMatchesPurpose,
  itemMatchesQuery,
  orderInboxItems,
  resolvePurposeFilter,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import {
  InboxPhoneRow,
  InboxTableRow,
  inboxTableKind,
} from "@/components/InboxItemRow";
import type { InboxReturn } from "@/lib/inboxHref";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { visitBoardForDay, visitBoardForWeek } from "@/lib/runSheet";
import { parseDayParam, parseWeekParam } from "@/lib/visitCalendar";
import { btnGhost, btnPrimary, deskEmptyClass } from "@/components/ui/deskChrome";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function EmptyInbox({
  total,
  pendingDid,
  did,
  purpose,
  q,
  vertical,
  emptyLabel,
  listHref,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
  purpose: InboxPurposeFilterId;
  q: string;
  vertical?: string | null;
  emptyLabel?: string;
  listHref?: string;
}) {
  const copy = nicheCopy(vertical);
  if (q) {
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">No matches</p>
        <Link
          href={callsHref({ purpose })}
          className={`${btnGhost} mt-6`}
        >
          Clear search
        </Link>
      </div>
    );
  }

  if (emptyLabel) {
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">{emptyLabel}</p>
        <Link href={listHref || callsHref({ purpose: "job" })} className={`${btnGhost} mt-6`}>
          List
        </Link>
      </div>
    );
  }

  if (total > 0) {
    const filterEmpty =
      purpose === "hold"
        ? copy.holdEmpty
        : purpose === "job"
          ? copy.jobEmpty
          : purpose === "needs"
            ? "Nothing needs you"
            : "Nothing in this filter";
    return (
      <div className={deskEmptyClass}>
        <p className="font-display text-2xl tracking-tight text-ink">{filterEmpty}</p>
        <Link
          href={callsHref({ purpose: "all" })}
          className={`${btnGhost} mt-6`}
        >
          Show all
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-8 border-y border-accent/30 bg-accent/5 py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">Number being assigned</p>
        <Link
          href={businessSettingsHref("train")}
          className={`${btnPrimary} mt-6 px-5`}
        >
          Train
        </Link>
      </div>
    );
  }

  return (
    <div className={deskEmptyClass}>
      <p className="font-display text-2xl tracking-tight text-ink">Inbox is empty</p>
      {did ? (
        <a href={`tel:${did}`} className={`${btnGhost} mt-6`}>
          {did}
        </a>
      ) : (
        <Link href={businessSettingsHref("test")} className={`${btnGhost} mt-6`}>
          Test line
        </Link>
      )}
    </div>
  );
}


export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    status?: string;
    purpose?: string;
    q?: string;
    view?: string;
    week?: string;
    day?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(sp.q);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const client = workspace.client;
  const businessName = tenant.business_name?.trim() || "us";
  const vertical = tenant.vertical;
  const copy = nicheCopy(vertical);

  const { items: assembled, error, partialError } = await loadInboxItems(
    client,
    tenant.id,
    vertical
  );

  if (error) {
    return <DeskError>Could not load inbox.</DeskError>;
  }

  const searched = q
    ? assembled.filter((item) => itemMatchesQuery(item, q))
    : assembled;
  const counts = countInboxPurposes(searched);
  const activeFilter = resolvePurposeFilter(sp.purpose, sp.status, counts.needs);
  const filtered = orderInboxItems(
    searched.filter((item) => itemMatchesPurpose(item, activeFilter)),
    activeFilter
  );
  const view = String(sp.view || "");
  const weekView = activeFilter === "job" && view === "week";
  const todayView = activeFilter === "job" && view === "today";
  const monday = parseWeekParam(sp.week);
  const day = parseDayParam(sp.day);
  const visible = todayView
    ? visitBoardForDay(searched, day)
    : weekView
      ? visitBoardForWeek(searched, monday)
      : filtered;
  const total = visible.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = visible.slice(from, from + PAGE_SIZE);

  const paginationParams: Record<string, string | undefined> = {
    purpose: activeFilter,
    q: q || undefined,
    view: weekView ? "week" : todayView ? "today" : undefined,
  };
  const inboxRet: InboxReturn = {
    purpose: activeFilter,
    q: q || undefined,
    page,
    view: weekView ? "week" : todayView ? "today" : undefined,
  };

  return (
    <div>
      <InboxToolbar
        active={activeFilter}
        counts={counts}
        q={q}
        caption={inboxCaption(searched, vertical)}
        vertical={vertical}
        view={todayView || weekView ? view : undefined}
      />

      {partialError ? (
        <div className="mt-6">
          <DeskError>{partialError}</DeskError>
        </div>
      ) : null}

      {pageRows.length === 0 ? (
        <EmptyInbox
          total={filtered.length}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          purpose={activeFilter}
          q={q}
          vertical={vertical}
          emptyLabel={
            todayView ? copy.todayEmpty : weekView ? copy.jobEmpty : undefined
          }
          listHref={
            todayView || weekView
              ? callsHref({ purpose: "job", q: q || undefined })
              : undefined
          }
        />
      ) : (
        <>
          <DeskLandScope
            ids={pageRows.map((item) => item.id)}
            scopeKey={`${activeFilter}:${view || "list"}:${page}:${q}`}
          >
          <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {pageRows.map((item) => (
              <InboxPhoneRow
                key={item.id}
                item={item}
                businessName={businessName}
                purpose={activeFilter}
                vertical={vertical}
                ret={inboxRet}
              />
            ))}
          </ul>
          <div className="mt-8 hidden md:block">
            <DeskDataTable minWidthClass="min-w-[720px]">
              <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                <tr>
                  {inboxTableKind(activeFilter) === "hold" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Item
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Who
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Needed
                      </th>
                    </>
                  ) : null}
                  {inboxTableKind(activeFilter) === "job" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        {copy.jobColumn}
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Who
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Place
                      </th>
                    </>
                  ) : null}
                  {inboxTableKind(activeFilter) === "mixed" ? (
                    <>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Work
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        Needed
                      </th>
                      <th scope="col" className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]">
                        When
                      </th>
                    </>
                  ) : null}
                  <th scope="col" className="px-5 py-4 text-right text-xs font-semibold uppercase tracking-[0.14em]">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((item) => (
                  <InboxTableRow
                    key={item.id}
                    item={item}
                    businessName={businessName}
                    purpose={activeFilter}
                    vertical={vertical}
                    ret={inboxRet}
                  />
                ))}
              </tbody>
            </DeskDataTable>
          </div>
          </DeskLandScope>

          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href="/calls"
            params={paginationParams}
          />
        </>
      )}
    </div>
  );
}
