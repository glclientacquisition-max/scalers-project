import Link from "next/link";
import { AppointmentStatusToggle } from "@/components/AppointmentStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { formatCallWhen } from "@/lib/callsTriage";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

type AppointmentRow = {
  id: string;
  created_at: string;
  service_name: string;
  status: string;
  when_text: string | null;
  address_landmark: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "requested", label: "Requested" },
  { id: "confirmed", label: "Confirmed" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

function appointmentsHref(opts: { status?: string; page?: number }): string {
  const q = new URLSearchParams();
  if (opts.status === "all") q.set("status", "all");
  else if (opts.status && opts.status !== "requested") q.set("status", opts.status);
  if (opts.page && opts.page > 1) q.set("page", String(opts.page));
  const qs = q.toString();
  return qs ? `/appointments?${qs}` : "/appointments";
}

function parseStatus(raw: string): StatusFilterId {
  if (
    raw === "all" ||
    raw === "requested" ||
    raw === "confirmed" ||
    raw === "done" ||
    raw === "cancelled"
  ) {
    return raw;
  }
  return "requested";
}

function tabClass(active: boolean) {
  return [
    "inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-focus",
    active
      ? "border-[#0096FF] text-[#005ccc]"
      : "border-transparent text-ink-soft hover:border-line hover:text-ink",
  ].join(" ");
}

function RelatedCallLink({ callId }: { callId: string | null }) {
  if (!callId) return null;
  return (
    <Link
      href={`/calls/${callId}`}
      className="font-medium text-[#0096FF] hover:text-[#005ccc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
    >
      Open
    </Link>
  );
}

export default async function AppointmentsPage({
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
    String(
      Array.isArray(params.status) ? params.status[0] : params.status || "requested"
    )
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
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id);
    if (status && status !== "all") query = query.eq("status", status);
    return query;
  };

  let listQuery = client
    .from("appointments")
    .select(
      "id, created_at, service_name, status, when_text, address_landmark, caller_name, caller_phone, call_id"
    )
    .eq("tenant_id", tenant.id);
  if (statusFilter !== "all") listQuery = listQuery.eq("status", statusFilter);

  const [allRes, requestedRes, confirmedRes, doneRes, cancelledRes, listRes] =
    await Promise.all([
      countQuery("all"),
      countQuery("requested"),
      countQuery("confirmed"),
      countQuery("done"),
      countQuery("cancelled"),
      listQuery.order("created_at", { ascending: false }).range(from, to),
    ]);

  const counts = {
    all: allRes.error ? null : allRes.count ?? 0,
    requested: requestedRes.error ? null : requestedRes.count ?? 0,
    confirmed: confirmedRes.error ? null : confirmedRes.count ?? 0,
    done: doneRes.error ? null : doneRes.count ?? 0,
    cancelled: cancelledRes.error ? null : cancelledRes.count ?? 0,
  };

  let rows: AppointmentRow[] = [];
  let loadError: string | null = null;
  if (listRes.error) {
    loadError = "Appointments could not be loaded.";
  } else {
    rows = (listRes.data || []) as AppointmentRow[];
  }

  const total = counts[statusFilter];

  return (
    <div>
      <h1 className="font-display tracking-tight text-ink text-[clamp(1.75rem,5vw,2.25rem)]">
        Appointments
      </h1>

      <nav aria-label="Filter by status" className="mt-6 min-w-0 border-b border-line">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:thin]">
          {STATUS_FILTERS.map((item) => {
            const active = statusFilter === item.id;
            const count = counts[item.id];
            return (
              <li key={item.id} className="shrink-0">
                <Link
                  href={appointmentsHref({ status: item.id })}
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

      {loadError ? (
        <p className="mt-6 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-6 border-y border-line py-10 text-center">
          <p className="font-display text-xl tracking-tight text-ink">
            {statusFilter === "all" ? "No appointments" : "No appointments in this filter"}
          </p>
          {statusFilter !== "all" ? (
            <Link
              href={appointmentsHref({ status: "all" })}
              className="mt-5 inline-flex rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-[#005ccc] transition hover:border-[#0096FF] focus-visible:outline-none focus-visible:shadow-focus"
            >
              Show all appointments
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
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Visit</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
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
                    <td className="px-4 py-3.5 text-ink">
                      {row.service_name?.trim() || ""}
                    </td>
                    <td className="px-4 py-3.5">
                      {row.when_text ? (
                        <div className="line-clamp-1 text-ink">{row.when_text}</div>
                      ) : null}
                      {row.address_landmark ? (
                        <div className="mt-0.5 line-clamp-1 text-ink-soft">
                          {row.address_landmark}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5">
                      <AppointmentStatusToggle id={row.id} status={row.status} />
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <RelatedCallLink callId={row.call_id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <p className="font-medium text-ink">
                  {row.caller_name?.trim() || "Unknown"}
                </p>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {row.service_name?.trim() || "Visit"}
                  {" · "}
                  {row.when_text?.trim() || formatCallWhen(row.created_at)}
                </p>
                {row.address_landmark ? (
                  <p className="mt-0.5 line-clamp-1 text-sm text-ink-soft">
                    {row.address_landmark}
                  </p>
                ) : null}
                <div className="mt-3">
                  <AppointmentStatusToggle id={row.id} status={row.status} />
                </div>
                <div className="mt-2 flex min-h-11 items-center justify-end gap-3">
                  {row.caller_phone ? <WhatsAppLink number={row.caller_phone} compact /> : null}
                  <RelatedCallLink callId={row.call_id} />
                </div>
              </li>
            ))}
          </ul>

          {total != null ? (
            <Pagination
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
              href="/appointments"
              params={{
                status: statusFilter === "requested" ? undefined : statusFilter,
              }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
