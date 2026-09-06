import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { FilterTabs } from "@/components/ui/FilterTabs";
import {
  focusRingVisible,
  pageTitleClass,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";

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

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-KE", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Nairobi",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

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

function statusLabel(status: string) {
  switch (status) {
    case "fulfilled":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "open":
      return "Open";
    default:
      return status;
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
  const typeFilter = String(
    Array.isArray(params.type) ? params.type[0] : params.type || "all"
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

  const workspace = await createWorkspaceDataClient();
  let rows: ServiceRequestRow[] = [];
  let loadError: string | null = null;
  let total = 0;
  let openCount = 0;

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
    if (typeFilter && typeFilter !== "all") {
      query = query.eq("request_type", typeFilter);
    }

    const [{ data, error, count }, openRes] = await Promise.all([
      query,
      workspace.client
        .from("service_requests")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", "open"),
    ]);

    if (error) {
      loadError = /service_requests|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as ServiceRequestRow[];
      total = count ?? rows.length;
      openCount = openRes.count ?? 0;
    }
  }

  const filterLink = (status: string, type: string) => {
    const q = new URLSearchParams();
    if (status && status !== "open") q.set("status", status);
    if (status === "all") q.set("status", "all");
    if (type && type !== "all") q.set("type", type);
    const s = q.toString();
    return s ? `/requests?${s}` : "/requests";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={pageTitleClass}>Requests</h1>
        <p className="text-sm text-ink-soft">
          <span className="font-display text-2xl tracking-tight text-ink">
            {openCount}
          </span>{" "}
          open
        </p>
      </div>

      <div className="mt-6">
        <FilterTabs
          label="Filter by status"
          active={statusFilter}
          items={[
            { id: "open", label: "Open", href: filterLink("open", typeFilter) },
            {
              id: "fulfilled",
              label: "Done",
              href: filterLink("fulfilled", typeFilter),
            },
            {
              id: "cancelled",
              label: "Cancelled",
              href: filterLink("cancelled", typeFilter),
            },
            { id: "all", label: "All", href: filterLink("all", typeFilter) },
          ]}
        />
      </div>
      <FilterTabs
        label="Filter by type"
        active={typeFilter}
        items={[
          { id: "all", label: "All types", href: filterLink(statusFilter, "all") },
          { id: "hold", label: "Holds", href: filterLink(statusFilter, "hold") },
          { id: "order", label: "Orders", href: filterLink(statusFilter, "order") },
          {
            id: "enquiry",
            label: "Enquiries",
            href: filterLink(statusFilter, "enquiry"),
          },
          {
            id: "callback",
            label: "Callbacks",
            href: filterLink(statusFilter, "callback"),
          },
        ]}
      />

      {loadError ? (
        <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-6 border-y border-line py-10 text-center">
          <p className="font-display text-xl tracking-tight text-ink">
            No requests in this filter
          </p>
        </div>
      ) : null}

      {!loadError && rows.length > 0 ? (
        <>
          <div className="mt-6">
            <DeskDataTable minWidthClass="min-w-[760px]">
              <thead className="border-b border-line bg-surface-muted/70 text-ink-soft">
                <tr>
                  <th className={tableHeadCellClass}>When</th>
                  <th className={tableHeadCellClass}>Caller</th>
                  <th className={tableHeadCellClass}>Request</th>
                  <th className={tableHeadCellClass}>Status</th>
                  <th className={tableHeadCellClass} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-line/70 hover:bg-surface-muted/30"
                  >
                    <td className={`${tableCellClass} whitespace-nowrap text-ink-soft`}>
                      {formatWhen(row.created_at)}
                    </td>
                    <td className={tableCellClass}>
                      <div className="font-medium text-ink">
                        {row.caller_name || "Caller"}
                      </div>
                      {row.caller_phone ? (
                        <WhatsAppLink number={row.caller_phone} />
                      ) : null}
                    </td>
                    <td className={tableCellClass}>
                      <div className="font-medium text-ink">
                        {typeLabel(row.request_type)}
                        {row.item ? ` · ${row.item}` : ""}
                        {row.quantity ? ` ×${row.quantity}` : ""}
                      </div>
                      {row.when_text ? (
                        <div className="mt-0.5 text-ink-soft">{row.when_text}</div>
                      ) : null}
                      {row.notes ? (
                        <div className="mt-0.5 line-clamp-1 text-ink-soft">
                          {row.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className={tableCellClass}>
                      <RequestStatusToggle id={row.id} status={row.status} />
                      <p className="sr-only">{statusLabel(row.status)}</p>
                    </td>
                    <td className={`${tableCellClass} text-right`}>
                      {row.call_id ? (
                        <Link
                          href={`/calls/${row.call_id}`}
                          className={`font-medium text-[#005CCC] ${focusRingVisible}`}
                        >
                          Open
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
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
              type: typeFilter !== "all" ? typeFilter : undefined,
            }}
          />
        </>
      ) : null}
    </div>
  );
}
