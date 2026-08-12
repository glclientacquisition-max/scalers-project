import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { RequestStatusToggle } from "@/components/RequestStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";

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
      return "Hold / pickup";
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

  const workspace = await createWorkspaceDataClient();
  let rows: ServiceRequestRow[] = [];
  let loadError: string | null = null;

  if (workspace) {
    let query = workspace.client
      .from("service_requests")
      .select(
        "id, created_at, request_type, status, item, quantity, when_text, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    if (typeFilter && typeFilter !== "all") {
      query = query.eq("request_type", typeFilter);
    }

    const { data, error } = await query;

    if (error) {
      loadError = /service_requests|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/contacts_and_requests.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as ServiceRequestRow[];
    }
  }

  const openCount = rows.filter((r) => r.status === "open").length;

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
        <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
          Requests
        </h1>
        <div className="rounded-2xl border border-line bg-surface px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
            Open
          </p>
          <p className="font-display text-2xl tracking-tight text-ink">{openCount}</p>
        </div>
      </div>

      <nav
        aria-label="Filter by status"
        className="mt-6 border-b border-line"
      >
        <ul className="flex gap-1 overflow-x-auto">
          {(
            [
              ["open", "Open"],
              ["fulfilled", "Done"],
              ["cancelled", "Cancelled"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => {
            const active = statusFilter === id;
            return (
              <li key={id}>
                <Link
                  href={filterLink(id, typeFilter)}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "inline-flex border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                    active
                      ? "border-[#0096FF] text-[#005ccc]"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
                  ].join(" ")}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <nav aria-label="Filter by type" className="mt-2 border-b border-line">
        <ul className="flex gap-1 overflow-x-auto">
          {(
            [
              ["all", "All types"],
              ["hold", "Holds"],
              ["order", "Orders"],
              ["enquiry", "Enquiries"],
              ["callback", "Callbacks"],
            ] as const
          ).map(([id, label]) => {
            const active = typeFilter === id;
            return (
              <li key={id}>
                <Link
                  href={filterLink(statusFilter, id)}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "inline-flex border-b-2 px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
                    active
                      ? "border-[#0096FF] text-[#005ccc]"
                      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
                  ].join(" ")}
                >
                  {label}
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
            No requests in this filter
          </p>
        </div>
      ) : null}

      <ul className="mt-6 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-line bg-surface px-5 py-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">
                  {typeLabel(row.request_type)} · {statusLabel(row.status)} ·{" "}
                  {formatWhen(row.created_at)}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {row.caller_name || "Caller"}
                </p>
                {row.item ? (
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {row.item}
                    {row.quantity ? ` (×${row.quantity})` : ""}
                  </p>
                ) : null}
                {row.when_text ? (
                  <p className="mt-2 text-sm text-ink">When: {row.when_text}</p>
                ) : null}
                {row.notes ? (
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                    {row.notes}
                  </p>
                ) : null}
              </div>
              <RequestStatusToggle id={row.id} status={row.status} />
            </div>
            {(row.caller_phone || row.call_id) && (
              <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-line/80 pt-4 text-sm">
                {row.caller_phone ? (
                  <WhatsAppLink number={row.caller_phone} label="WhatsApp caller" />
                ) : null}
                {row.call_id ? (
                  <Link
                    href={`/calls/${row.call_id}`}
                    className="font-medium text-[#0096FF] hover:text-[#005ccc] hover:underline"
                  >
                    Open call
                  </Link>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
