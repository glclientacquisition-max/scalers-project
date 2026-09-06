import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskPageHeader } from "@/components/ui/DeskPageHeader";
import { FilterTabs } from "@/components/ui/FilterTabs";
import {
  focusRingVisible,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";
import { requestWhatsAppMessage } from "@/lib/deskWorkQueues";

export const dynamic = "force-dynamic";

type ServiceRequestRow = {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  item: string | null;
  quantity: string | null;
  when_text: string | null;
  notes: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

function typeLabel(type: string) {
  switch (type) {
    case "hold":
      return "Hold";
    case "order":
      return "Order";
    case "callback":
      return "Callback";
    case "enquiry":
      return "Enquiry";
    default:
      return type || "Request";
  }
}

export default async function RequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        Sign in to view requests.
      </div>
    );
  }

  const params = (await searchParams) || {};
  const statusFilter = String(
    Array.isArray(params.status) ? params.status[0] : params.status || "open"
  )
    .trim()
    .toLowerCase();
  const page = Math.max(
    1,
    Number.parseInt(
      String(Array.isArray(params.page) ? params.page[0] : params.page || "1"),
      10
    ) || 1
  );
  const from = (page - 1) * DEFAULT_PAGE_SIZE;
  const to = from + DEFAULT_PAGE_SIZE - 1;
  const businessName = tenant.business_name?.trim() || "us";

  const workspace = await createWorkspaceDataClient();
  let rows: ServiceRequestRow[] = [];
  let loadError: string | null = null;
  let total = 0;
  let openCount = 0;
  let doneCount = 0;
  let cancelledCount = 0;
  let allCount = 0;

  if (workspace) {
    let query = workspace.client
      .from("service_requests")
      .select(
        "id, created_at, request_type, status, item, quantity, when_text, notes, caller_name, caller_phone, call_id",
        { count: "exact" }
      )
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const countEq = (status: string) =>
      workspace.client
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", status);

    const [{ data, error, count }, openRes, doneRes, cancelledRes, allRes] =
      await Promise.all([
        query,
        countEq("open"),
        countEq("fulfilled"),
        countEq("cancelled"),
        workspace.client
          .from("service_requests")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
      ]);

    if (error) {
      loadError = /service_requests|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as ServiceRequestRow[];
      total = count ?? rows.length;
      openCount = openRes.count ?? 0;
      doneCount = doneRes.count ?? 0;
      cancelledCount = cancelledRes.count ?? 0;
      allCount = allRes.count ?? 0;
    }
  }

  const filterLink = (status: string) => {
    const q = new URLSearchParams();
    if (status && status !== "open") q.set("status", status);
    if (status === "all") q.set("status", "all");
    const s = q.toString();
    return s ? `/requests?${s}` : "/requests";
  };

  return (
    <div>
      <DeskPageHeader
        title="Requests"
        waiting={openCount}
        waitingLabel="open"
      />

      <div className="mt-6">
        <FilterTabs
          label="Filter by status"
          active={statusFilter}
          items={[
            { id: "open", label: "Open", href: filterLink("open"), count: openCount },
            {
              id: "fulfilled",
              label: "Done",
              href: filterLink("fulfilled"),
              count: doneCount,
            },
            {
              id: "cancelled",
              label: "Cancelled",
              href: filterLink("cancelled"),
              count: cancelledCount,
            },
            { id: "all", label: "All", href: filterLink("all"), count: allCount },
          ]}
        />
      </div>

      {loadError ? (
        <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-6 border-y border-line py-10 text-center">
          <p className="font-display text-xl tracking-tight text-ink">
            {statusFilter === "open"
              ? "Nothing to fulfill"
              : "No requests in this filter"}
          </p>
          {statusFilter !== "all" && allCount > 0 ? (
            <Link
              href={filterLink("all")}
              className={`mt-5 inline-flex min-h-11 items-center font-medium text-[#005CCC] ${focusRingVisible}`}
            >
              Show all requests
            </Link>
          ) : null}
        </div>
      ) : null}

      {!loadError && rows.length > 0 ? (
        <>
          <div className="mt-6">
            <DeskDataTable minWidthClass="min-w-[760px]">
              <thead className="border-b border-line bg-surface-muted/70 text-ink-soft">
                <tr>
                  <th className={tableHeadCellClass}>Item</th>
                  <th className={tableHeadCellClass}>Who</th>
                  <th className={tableHeadCellClass}>Needed</th>
                  <th className={tableHeadCellClass}>Status</th>
                  <th className={tableHeadCellClass} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const kind = typeLabel(row.request_type);
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-line/70 hover:bg-surface-muted/30"
                    >
                      <td className={tableCellClass}>
                        <div className="font-medium text-ink">
                          {row.item?.trim() || kind}
                          {row.quantity ? ` ×${row.quantity}` : ""}
                        </div>
                        <div className="mt-0.5 text-ink-soft">{kind}</div>
                        {row.notes ? (
                          <div className="mt-0.5 line-clamp-1 text-ink-soft">
                            {row.notes}
                          </div>
                        ) : null}
                      </td>
                      <td className={tableCellClass}>
                        <div className="font-medium text-ink">
                          {row.caller_name || "Caller"}
                        </div>
                        {row.caller_phone ? (
                          <WhatsAppLink
                            number={row.caller_phone}
                            message={requestWhatsAppMessage({
                              businessName,
                              name: row.caller_name,
                              type: kind.toLowerCase(),
                              item: row.item,
                            })}
                          />
                        ) : null}
                      </td>
                      <td className={`${tableCellClass} text-ink-soft`}>
                        {row.when_text?.trim() || "Anytime"}
                      </td>
                      <td className={tableCellClass}>
                        <RequestStatusToggle id={row.id} status={row.status} />
                      </td>
                      <td className={`${tableCellClass} text-right`}>
                        {row.call_id ? (
                          <Link
                            href={`/calls/${row.call_id}`}
                            className={`font-medium text-[#005CCC] ${focusRingVisible}`}
                          >
                            Call
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DeskDataTable>
          </div>
          <Pagination
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            total={total}
            href="/requests"
            params={{
              status: statusFilter !== "open" ? statusFilter : undefined,
            }}
          />
        </>
      ) : null}
    </div>
  );
}
