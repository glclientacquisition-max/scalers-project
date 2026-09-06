import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { AppointmentStatusToggle } from "@/components/AppointmentStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { businessSettingsHref } from "@/lib/businessSettingsNav";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { FilterTabs } from "@/components/ui/FilterTabs";
import {
  btnGhost,
  focusRingVisible,
  pageTitleClass,
  tableCellClass,
  tableHeadCellClass,
} from "@/components/ui/deskChrome";

export const dynamic = "force-dynamic";

type AppointmentRow = {
  id: string;
  created_at: string;
  service_name: string;
  status: string;
  when_text: string | null;
  address_landmark: string | null;
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

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        Sign in to view appointments.
      </div>
    );
  }

  const params = (await searchParams) || {};
  const statusFilter = String(
    Array.isArray(params.status) ? params.status[0] : params.status || "requested"
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
  let rows: AppointmentRow[] = [];
  let loadError: string | null = null;
  let total = 0;
  let requestedCount = 0;

  if (workspace) {
    let query = workspace.client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id",
        { count: "exact" }
      )
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const [{ data, error, count }, requestedRes] = await Promise.all([
      query,
      workspace.client
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", "requested"),
    ]);

    if (error) {
      loadError = /appointments|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/appointments.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as AppointmentRow[];
      total = count ?? rows.length;
      requestedCount = requestedRes.count ?? 0;
    }
  }

  const filterLink = (status: string) => {
    const q = new URLSearchParams();
    if (status && status !== "requested") q.set("status", status);
    if (status === "all") q.set("status", "all");
    const s = q.toString();
    return s ? `/appointments?${s}` : "/appointments";
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className={pageTitleClass}>Appointments</h1>
        <p className="text-sm text-ink-soft">
          <span className="font-display text-2xl tracking-tight text-ink">
            {requestedCount}
          </span>{" "}
          requested
        </p>
      </div>

      <div className="mt-6">
        <FilterTabs
          label="Filter by status"
          active={statusFilter}
          items={[
            { id: "requested", label: "Requested", href: filterLink("requested") },
            { id: "confirmed", label: "Confirmed", href: filterLink("confirmed") },
            { id: "done", label: "Done", href: filterLink("done") },
            { id: "cancelled", label: "Cancelled", href: filterLink("cancelled") },
            { id: "all", label: "All", href: filterLink("all") },
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
            No appointments in this filter
          </p>
          <Link href={businessSettingsHref("train")} className={`${btnGhost} mt-5`}>
            Train
          </Link>
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
                  <th className={tableHeadCellClass}>Visit</th>
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
                      <div className="font-medium text-ink">{row.service_name}</div>
                      {row.when_text ? (
                        <div className="mt-0.5 text-ink-soft">{row.when_text}</div>
                      ) : null}
                      {row.address_landmark ? (
                        <div className="mt-0.5 text-ink-soft">
                          {row.address_landmark}
                        </div>
                      ) : null}
                      {row.notes ? (
                        <div className="mt-0.5 line-clamp-1 text-ink-soft">
                          {row.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className={tableCellClass}>
                      <AppointmentStatusToggle id={row.id} status={row.status} />
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
            href="/appointments"
            params={{
              status: statusFilter !== "requested" ? statusFilter : undefined,
            }}
          />
        </>
      ) : null}
    </div>
  );
}
