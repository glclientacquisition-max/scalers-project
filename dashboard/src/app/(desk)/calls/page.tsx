import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { InboxToolbar } from "@/components/InboxToolbar";
import { InboxPurposeChip } from "@/components/InboxPurposeChip";
import { InboxJobActions } from "@/components/InboxJobActions";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import {
  callsHref,
  followUpWhatsAppMessage,
  formatCallWhenRelative,
  sanitizeSearchQuery,
} from "@/lib/callsTriage";
import { loadInboxItems } from "@/lib/inboxLoad";
import { nicheCopy } from "@/lib/inboxNiche";
import {
  countInboxPurposes,
  holdTypeLabel,
  inboxCaption,
  itemMatchesPurpose,
  itemMatchesQuery,
  itemSignalLabel,
  resolvePurposeFilter,
  type InboxItem,
  type InboxPurposeFilterId,
} from "@/lib/inboxPurpose";

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

function inboxTableKind(
  purpose: InboxPurposeFilterId
): "hold" | "job" | "mixed" {
  if (purpose === "hold") return "hold";
  if (purpose === "job") return "job";
  return "mixed";
}

function InboxRow({
  item,
  businessName,
  purpose,
  vertical,
}: {
  item: InboxItem;
  businessName: string;
  purpose: InboxPurposeFilterId;
  vertical?: string | null;
}) {
  const kind = inboxTableKind(purpose);
  const message = followUpWhatsAppMessage({
    businessName,
    name: item.callerName,
    reason: item.headline,
  });
  const openHref = item.callId
    ? `/calls/${item.callId}?from=${purpose}`
    : null;
  const openLabel = item.hold || item.job ? "Call" : "Open";
  const needed = item.hold?.when_text?.trim() || "Anytime";
  const visit = item.job?.when_text?.trim() || "Time TBD";
  const place = item.job?.address_landmark?.trim() || "Ask on the call";

  return (
    <tr
      className={[
        "group border-t border-line/70 transition duration-150",
        "hover:bg-[#0096FF]/[0.04] active:bg-[#0096FF]/[0.07]",
        item.urgent ? "bg-warn-soft/50" : "",
        item.needsYou ? "" : "opacity-[0.92]",
      ].join(" ")}
    >
      {kind === "hold" ? (
        <>
          <td className="px-5 py-5 align-top">
            <p className="text-base font-semibold tracking-tight text-ink">
              {item.headline}
            </p>
            {item.hold ? (
              <p className="mt-0.5 text-sm text-ink-soft">
                {holdTypeLabel(item.hold.request_type, vertical)}
              </p>
            ) : null}
          </td>
          <td className="px-5 py-5 align-top">
            <p className="font-medium text-ink">
              {item.contactId ? (
                <Link
                  href={`/contacts/${item.contactId}`}
                  className="text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                >
                  {item.callerName || "Caller"}
                </Link>
              ) : (
                item.callerName || "Caller"
              )}
            </p>
            {item.callerPhone ? (
              <WhatsAppLink number={item.callerPhone} message={message} compact />
            ) : null}
          </td>
          <td className="px-5 py-5 align-top text-sm text-ink-soft">{needed}</td>
        </>
      ) : null}

      {kind === "job" ? (
        <>
          <td className="px-5 py-5 align-top">
            <p className="text-base font-semibold tracking-tight text-ink">{visit}</p>
            <p className="mt-0.5 text-sm text-ink-soft">{item.headline}</p>
          </td>
          <td className="px-5 py-5 align-top">
            <p className="font-medium text-ink">
              {item.contactId ? (
                <Link
                  href={`/contacts/${item.contactId}`}
                  className="text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                >
                  {item.callerName || "Caller"}
                </Link>
              ) : (
                item.callerName || "Caller"
              )}
            </p>
            {item.callerPhone ? (
              <WhatsAppLink number={item.callerPhone} message={message} compact />
            ) : null}
          </td>
          <td className="px-5 py-5 align-top text-sm text-ink-soft">{place}</td>
        </>
      ) : null}

      {kind === "mixed" ? (
        <>
          <td className="px-5 py-5 align-top">
            <p className="text-base font-semibold tracking-tight text-ink">
              {item.contactId ? (
                <Link
                  href={`/contacts/${item.contactId}`}
                  className="text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                >
                  {item.callerName || item.callerPhone || "Caller"}
                </Link>
              ) : (
                item.callerName || item.callerPhone || "Caller"
              )}
            </p>
            <p className="mt-0.5 text-sm font-medium text-ink">{item.headline}</p>
            {item.detail ? (
              <p className="mt-1 line-clamp-1 text-sm text-ink-soft">{item.detail}</p>
            ) : null}
          </td>
          <td className="px-5 py-5 align-top">
            <InboxPurposeChip
              purpose={item.purpose}
              label={itemSignalLabel(item, vertical)}
            />
          </td>
          <td className="whitespace-nowrap px-5 py-5 align-top text-sm text-ink-soft">
            {formatCallWhenRelative(item.createdAt)}
          </td>
        </>
      ) : null}

      <td className="px-5 py-5 align-top">
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {item.job ? (
            <InboxJobActions id={item.job.id} status={item.job.status} />
          ) : item.hold ? (
            <RequestStatusToggle id={item.hold.id} status={item.hold.status} />
          ) : item.callerPhone ? (
            <WhatsAppLink
              number={item.callerPhone}
              message={message}
              variant="primary"
              label="WhatsApp"
            />
          ) : null}
        </div>
      </td>
      <td className="px-5 py-5 align-top text-right">
        {openHref ? (
          <Link
            href={openHref}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-[#005CCC] transition duration-150 hover:text-[#004a99] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
          >
            {openLabel}
          </Link>
        ) : (
          <span className="text-sm text-ink-soft">No call</span>
        )}
      </td>
    </tr>
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
        <Link href="/signup" className="text-[#0096FF]">
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
  const total = filtered.length;
  const from = (page - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(from, from + PAGE_SIZE);

  const paginationParams: Record<string, string | undefined> = {
    purpose: activeFilter,
    q: q || undefined,
  };

  return (
    <div>
      <InboxToolbar
        active={activeFilter}
        counts={counts}
        q={q}
        caption={inboxCaption(searched, vertical)}
        vertical={vertical}
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
      ) : (
        <>
          <div className="mt-8">
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
                  <InboxRow
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
