import Link from "next/link";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { formatCallWhen } from "@/lib/callsTriage";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

type ServiceRequestRow = {
  id: string;
  created_at: string;
  request_type: string;
  status: string;
  item: string | null;
  quantity: string | null;
  when_text: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "fulfilled", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;

const TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "hold", label: "Holds" },
  { id: "order", label: "Orders" },
  { id: "enquiry", label: "Enquiries" },
  { id: "callback", label: "Callbacks" },
  { id: "other", label: "Other" },
] as const;

type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];
type TypeFilterId = (typeof TYPE_FILTERS)[number]["id"];

function requestsHref(opts: {
  status?: string;
  type?: string;
  page?: number;
}): string {
  const q = new URLSearchParams();
  if (opts.status === "all") q.set("status", "all");
  else if (opts.status && opts.status !== "open") q.set("status", opts.status);
  if (opts.type && opts.type !== "all") q.set("type", opts.type);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/requests?${qs}` : "/requests";
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
    case "other":
      return "Other";
    default:
      return type || "Request";
  }
}

function parseStatus(raw: string): StatusFilterId {
  if (raw === "all" || raw === "open" || raw === "fulfilled" || raw === "cancelled") {
    return raw;
  }
  return "open";
}

function parseType(raw: string): TypeFilterId {
  if (
    raw === "all" ||
    raw === "hold" ||
    raw === "order" ||
    raw === "enquiry" ||
    raw === "callback" ||
    raw === "other"
  ) {
    return raw;
  }
  return "all";
}

function tabClass(active: boolean) {
  return [
    "inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    active
      ? "border-[#0096FF] text-[#005ccc]"
      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
  ].join(" ");
}

function itemLine(row: ServiceRequestRow) {
  const item = row.item?.trim() || "";
  const qty = row.quantity?.trim() || "";
  if (!item && !qty) return "";
  if (item && qty) return `${item} (x${qty})`;
  return item || qty;
}

function RequestActions({ row }: { row: ServiceRequestRow }) {
  if (!row.call_id) return null;
  return (
    <Link
      href={`/calls/${row.call_id}`}
      className="font-medium text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
    >
      Open
    </Link>
  );
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
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[#0096FF]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const params = (await searchParams) || {};
  const statusFilter = parseStatus(
    String(Array.isArray(params.status) ? params.status[0] : params.status || "open")
      .trim()
      .toLowerCase()
  );
  const typeFilter = parseType(
    String(Array.isArray(params.type) ? params.type[0] : params.type || "all")
      .trim()
      .toLowerCase()
  );
  const page = Math.max(1, Number.parseInt(String(params.page || "1"), 10) || 1);
  const from = (page - 1) * DEFAULT_PAGE_SIZE;
  const to = from + DEFAULT_PAGE_SIZE - 1;

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Not signed in.
      </div>
    );
  }

  const client = workspace.client;
  const countQuery = (status?: StatusFilterId) => {
    let query = client
      .from("service_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);
    if (typeFilter !== "all") query = query.eq("request_type", typeFilter);
    if (status && status !== "all") query = query.eq("status", status);
    return query;
  };

  let listQuery = client
    .from("service_requests")
    .select(
      "id, created_at, request_type, status, item, quantity, when_text, caller_name, caller_phone, call_id"
    )
    .eq("tenant_id", tenant.id);
  if (typeFilter !== "all") listQuery = listQuery.eq("request_type", typeFilter);
  if (statusFilter !== "all") listQuery = listQuery.eq("status", statusFilter);

  const [allRes, openRes, doneRes, cancelledRes, listRes] = await Promise.all([
    countQuery("all"),
    countQuery("open"),
    countQuery("fulfilled"),
    countQuery("cancelled"),
    listQuery.order("created_at", { ascending: false }).range(from, to),
  ]);

  const counts = {
    all: allRes.error ? null : allRes.count ?? 0,
    open: openRes.error ? null : openRes.count ?? 0,
    fulfilled: doneRes.error ? null : doneRes.count ?? 0,
    cancelled: cancelledRes.error ? null : cancelledRes.count ?? 0,
  };

  let rows: ServiceRequestRow[] = [];
  let loadError: string | null = null;
  if (listRes.error) {
    loadError = "Requests could not be loaded.";
  } else {
    rows = (listRes.data || []) as ServiceRequestRow[];
  }

  const total = counts[statusFilter];

  return (
    <div>
      <h1 className="font-display tracking-tight text-ink text-[clamp(1.75rem,5vw,2.25rem)]">
        Requests
      </h1>

      <nav aria-label="Filter by status" className="mt-6 min-w-0 border-b border-line">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          {STATUS_FILTERS.map((item) => {
            const active = statusFilter === item.id;
            const count = counts[item.id];
            return (
              <li key={item.id} className="shrink-0">
                <Link
                  href={requestsHref({ status: item.id, type: typeFilter })}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {item.label}
                  {count != null ? (
                    <span
                      className={[
                        "tabular-nums text-xs",
                        active ? "text-[#005ccc]" : "text-ink-soft",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Filter by type" className="min-w-0 border-b border-line">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          {TYPE_FILTERS.map((item) => {
            const active = typeFilter === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <Link
                  href={requestsHref({ status: statusFilter, type: item.id })}
                  aria-current={active ? "page" : undefined}
                  className={tabClass(active)}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {loadError ? (
        <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-6 border-y border-line py-10 text-center">
          <p className="font-display text-xl tracking-tight text-ink">
            {statusFilter === "all" && typeFilter === "all"
              ? "No requests"
              : "No requests in this filter"}
          </p>
          {statusFilter !== "all" || typeFilter !== "all" ? (
            <Link
              href={requestsHref({ status: "all", type: "all" })}
              className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] transition hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
            >
              Show all requests
            </Link>
          ) : null}
        </div>
      ) : null}

      {!loadError && rows.length > 0 ? (
        <>
          <div className="mt-6 hidden overflow-x-auto rounded-2xl border border-line bg-surface md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-line bg-surface-muted/70 text-ink-soft">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Caller</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const item = itemLine(row);
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-line/70 transition hover:bg-surface-muted/30"
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 text-ink-soft">
                        {formatCallWhen(row.created_at)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-ink">
                          {row.caller_name?.trim() || "Unknown"}
                        </div>
                        {row.caller_phone ? (
                          <div className="mt-0.5">
                            <WhatsAppLink number={row.caller_phone} />
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5 text-ink">{typeLabel(row.request_type)}</td>
                      <td className="px-4 py-3.5">
                        {item ? (
                          <div className="line-clamp-1 text-ink">{item}</div>
                        ) : null}
                        {row.when_text ? (
                          <div className="mt-0.5 line-clamp-1 text-ink-soft">{row.when_text}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3.5">
                        <RequestStatusToggle id={row.id} status={row.status} />
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <RequestActions row={row} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {rows.map((row) => {
              const item = itemLine(row);
              return (
                <li key={row.id} className="px-4 py-3">
                  <p className="font-medium text-ink">
                    {row.caller_name?.trim() || "Unknown"}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {typeLabel(row.request_type)}
                    {" · "}
                    {formatCallWhen(row.created_at)}
                  </p>
                  {item ? <p className="mt-1 line-clamp-1 text-sm text-ink">{item}</p> : null}
                  {row.when_text ? (
                    <p className="mt-0.5 line-clamp-1 text-sm text-ink-soft">{row.when_text}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <RequestStatusToggle id={row.id} status={row.status} />
                    <div className="flex min-h-11 items-center gap-3">
                      {row.caller_phone ? <WhatsAppLink number={row.caller_phone} compact /> : null}
                      <RequestActions row={row} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {total != null ? (
            <Pagination
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
              href="/requests"
              params={{
                status: statusFilter === "open" ? undefined : statusFilter,
                type: typeFilter === "all" ? undefined : typeFilter,
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
