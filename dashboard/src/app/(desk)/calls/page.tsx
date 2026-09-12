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
  resolvePurposeFilter,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";
import {
  InboxPhoneRow,
  InboxTableRow,
  inboxTableKind,
} from "@/components/InboxItemRow";
import { VisitWeekCalendar } from "@/components/VisitWeekCalendar";
import {
  parseWeekParam,
  shiftWeekYmd,
} from "@/lib/visitCalendar";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function EmptyInbox({
  total,
  pendingDid,
  did,
  purpose,
  q,
  vertical,
}: {
  total: number;
  pendingDid: boolean;
  did: string;
  purpose: InboxPurposeFilterId;
  q: string;
  vertical?: string | null;
}) {
  const copy = nicheCopy(vertical);
  if (q) {
    return (
      <div className="mt-8 border-y border-line py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">No matches</p>
        <Link
          href={callsHref({ purpose })}
          className="mt-6 inline-flex min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-[#005ccc] transition duration-150 hover:border-[#0096FF] hover:text-[#0096FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
        >
          Clear search
        </Link>
      </div>
    );
  }

  if (total > 0) {
    const emptyLabel =
      purpose === "hold"
        ? copy.holdEmpty
        : purpose === "job"
          ? copy.jobEmpty
          : purpose === "needs"
            ? "Nothing needs you"
            : "Nothing in this filter";
    return (
      <div className="mt-8 border-y border-line py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">{emptyLabel}</p>
        <Link
          href={callsHref({ purpose: "all" })}
          className="mt-6 inline-flex min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-[#005ccc] transition duration-150 hover:border-[#0096FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
        >
          Show all
        </Link>
      </div>
    );
  }

  if (pendingDid) {
    return (
      <div className="mt-8 border-y border-[#0096FF]/30 bg-[#0096FF]/5 py-12 text-center">
        <p className="font-display text-2xl tracking-tight text-ink">Number being assigned</p>
        <Link
          href={businessSettingsHref("train")}
          className="mt-6 inline-flex min-h-11 rounded-xl bg-[#0096FF] px-5 text-sm font-semibold text-white transition duration-150 hover:bg-[#0088e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
        >
          Train
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-8 border-y border-line py-12 text-center text-ink-soft">
      <p className="font-display text-2xl tracking-tight text-ink">Inbox is empty</p>
      <p className="mx-auto mt-2 max-w-md text-sm">
        Call{" "}
        <a
          href={`tel:${did}`}
          className="font-medium text-[#005ccc] underline decoration-[#0096FF]/40 underline-offset-2 transition hover:text-[#0096FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
        >
          {did}
        </a>{" "}
        from another phone.
      </p>
      <Link
        href={businessSettingsHref("test")}
        className="mt-6 inline-flex min-h-11 rounded-xl border border-line px-4 text-sm font-medium text-[#005ccc] transition duration-150 hover:border-[#0096FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
      >
        Test line
      </Link>
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
  }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const q = sanitizeSearchQuery(sp.q);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[#005CCC]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Not signed in.
      </div>
    );
  }

  const client = workspace.client;
  const businessName = tenant.business_name?.trim() || "us";
  const vertical = tenant.vertical;
  const copy = nicheCopy(vertical);

  const { items: assembled, error } = await loadInboxItems(
    client,
    tenant.id,
    vertical
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load inbox: {error}
        {/row-level security|permission denied|rls/i.test(error) ? (
          <p className="mt-2 text-sm text-ink-soft">
            Apply docs/supabase/owner_rls.sql in Supabase if you have not yet.
          </p>
        ) : null}
      </div>
    );
  }

  const searched = q
    ? assembled.filter((item) => itemMatchesQuery(item, q))
    : assembled;
  const counts = countInboxPurposes(searched);
  const activeFilter = resolvePurposeFilter(sp.purpose, sp.status, counts.needs);
  const filtered = searched.filter((item) => itemMatchesPurpose(item, activeFilter));
  const weekView = activeFilter === "job" && String(sp.view || "") === "week";
  const monday = parseWeekParam(sp.week);
  const total = filtered.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = weekView ? filtered : filtered.slice(from, from + PAGE_SIZE);

  const paginationParams: Record<string, string | undefined> = {
    purpose: activeFilter,
    q: q || undefined,
    view: weekView ? "week" : undefined,
    week: weekView ? monday : undefined,
  };

  return (
    <div>
      <InboxToolbar
        active={activeFilter}
        counts={counts}
        q={q}
        caption={inboxCaption(searched, vertical)}
        vertical={vertical}
        view={weekView ? "week" : undefined}
        week={weekView ? monday : undefined}
      />

      {pageRows.length === 0 ? (
        <EmptyInbox
          total={total}
          pendingDid={String(tenant.sautikit_virtual_number || "").startsWith("pending:")}
          did={tenant.sautikit_virtual_number}
          purpose={activeFilter}
          q={q}
          vertical={vertical}
        />
      ) : weekView ? (
        <VisitWeekCalendar
          items={filtered}
          monday={monday}
          prevHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, -1),
          })}
          nextHref={callsHref({
            purpose: "job",
            q: q || undefined,
            view: "week",
            week: shiftWeekYmd(monday, 1),
          })}
          listHref={callsHref({ purpose: "job", q: q || undefined })}
          businessName={businessName}
          vertical={vertical}
        />
      ) : (
        <>
          <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {pageRows.map((item) => (
              <InboxPhoneRow
                key={item.id}
                item={item}
                businessName={businessName}
                purpose={activeFilter}
                vertical={vertical}
              />
            ))}
          </ul>
          <div className="mt-8 hidden md:block">
            <DeskDataTable minWidthClass="min-w-[880px]">
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
                  <th scope="col" className="px-5 py-4">
                    <span className="sr-only">Call</span>
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
                  />
                ))}
              </tbody>
            </DeskDataTable>
          </div>

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
