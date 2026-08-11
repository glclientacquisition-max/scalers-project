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

export default async function RequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-[var(--ink-soft)]">Sign in to view requests.</p>
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
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-[var(--ink)]">
            Requests
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Holds, pickups, and order notes your receptionist logged from calls.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface px-5 py-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
            Showing open in list
          </p>
          <p className="font-display text-2xl text-[var(--ink)]">{openCount}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ["open", "Open"],
            ["fulfilled", "Fulfilled"],
            ["cancelled", "Cancelled"],
            ["all", "All statuses"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={filterLink(id, typeFilter)}
            className={[
              "rounded-lg border px-3 py-1.5 text-sm",
              statusFilter === id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-line bg-surface text-[var(--ink-soft)]",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {(
          [
            ["all", "All types"],
            ["hold", "Holds"],
            ["order", "Orders"],
            ["enquiry", "Enquiries"],
            ["callback", "Callbacks"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={filterLink(statusFilter, id)}
            className={[
              "rounded-lg border px-3 py-1.5 text-sm",
              typeFilter === id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]"
                : "border-line bg-surface text-[var(--ink-soft)]",
            ].join(" ")}
          >
            {label}
          </Link>
        ))}
      </div>

      {loadError ? (
        <p className="mt-8 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-[var(--warn)]">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
          <p className="text-[var(--ink)] font-medium">No requests in this filter</p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            When a caller asks to hold an item or leave an order note, it appears
            here.{" "}
            <Link href="/settings#train" className="text-[var(--accent)] hover:underline">
              Train your catalogue
            </Link>{" "}
            so the receptionist can log accurately.
          </p>
        </div>
      ) : null}

      <ul className="mt-8 space-y-3">
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-2xl border border-line bg-surface px-5 py-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
                  {typeLabel(row.request_type)} · {row.status} ·{" "}
                  {formatWhen(row.created_at)}
                </p>
                <p className="mt-1 font-medium text-[var(--ink)]">
                  {row.caller_name || "Caller"}
                  {row.item ? (
                    <span className="font-normal text-[var(--ink-soft)]">
                      {" "}
                      — {row.item}
                      {row.quantity ? ` (×${row.quantity})` : ""}
                    </span>
                  ) : null}
                </p>
                {row.when_text ? (
                  <p className="mt-1 text-sm text-[var(--ink)]">
                    When: {row.when_text}
                  </p>
                ) : null}
                {row.notes ? (
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{row.notes}</p>
                ) : null}
              </div>
              <RequestStatusToggle id={row.id} status={row.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {row.caller_phone ? (
                <WhatsAppLink number={row.caller_phone} label="WhatsApp caller" />
              ) : null}
              {row.call_id ? (
                <Link
                  href={`/calls`}
                  className="text-[var(--accent)] hover:underline"
                >
                  Related calls
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
