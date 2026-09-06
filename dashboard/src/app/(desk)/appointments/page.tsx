import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { AppointmentStatusToggle } from "@/components/AppointmentStatusToggle";
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
import { formatCallWhen } from "@/lib/callsTriage";
import { visitWhatsAppMessage } from "@/lib/deskWorkQueues";

export const dynamic = "force-dynamic";

type AppointmentRow = {
  id: string;
  created_at: string;
  service_name: string;
  status: string;
  when_text: string | null;
  window_start?: string | null;
  address_landmark: string | null;
  notes: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  call_id: string | null;
};

const APPOINTMENT_SELECT =
  "id, created_at, service_name, status, when_text, window_start, address_landmark, notes, caller_name, caller_phone, call_id";
const APPOINTMENT_SELECT_LEGACY =
  "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id";

function visitWhen(row: AppointmentRow): string {
  if (row.when_text?.trim()) return row.when_text.trim();
  if (row.window_start) return formatCallWhen(row.window_start);
  return "Time TBD";
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
  const businessName = tenant.business_name?.trim() || "us";

  const workspace = await createWorkspaceDataClient();
  let rows: AppointmentRow[] = [];
  let loadError: string | null = null;
  let total = 0;
  let requestedCount = 0;
  let confirmedCount = 0;
  let doneCount = 0;
  let cancelledCount = 0;
  let allCount = 0;

  if (workspace) {
    const countEq = (status: string) =>
      workspace.client
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.id)
        .eq("status", status);

    const runList = (select: string, orderWindow: boolean) => {
      let query = workspace.client
        .from("appointments")
        .select(select, { count: "exact" })
        .eq("tenant_id", tenant.id)
        .range(from, to);
      if (statusFilter && statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (orderWindow) {
        query = query
          .order("window_start", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });
      } else {
        query = query.order("created_at", { ascending: false });
      }
      return query;
    };

    const [first, requestedRes, confirmedRes, doneRes, cancelledRes, allRes] =
      await Promise.all([
        runList(APPOINTMENT_SELECT, true),
        countEq("requested"),
        countEq("confirmed"),
        countEq("done"),
        countEq("cancelled"),
        workspace.client
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id),
      ]);

    let data = first.data;
    let error = first.error;
    let count = first.count;

    if (error && /window_start|column/i.test(error.message)) {
      const retry = await runList(APPOINTMENT_SELECT_LEGACY, false);
      data = retry.data;
      error = retry.error;
      count = retry.count;
    }

    if (error) {
      loadError = /appointments|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/appointments.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as unknown as AppointmentRow[];
      total = count ?? rows.length;
      requestedCount = requestedRes.count ?? 0;
      confirmedCount = confirmedRes.count ?? 0;
      doneCount = doneRes.count ?? 0;
      cancelledCount = cancelledRes.count ?? 0;
      allCount = allRes.count ?? 0;
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
      <DeskPageHeader
        title="Appointments"
        waiting={requestedCount}
        waitingLabel="to confirm"
      />

      <div className="mt-6">
        <FilterTabs
          label="Filter by status"
          active={statusFilter}
          items={[
            {
              id: "requested",
              label: "Requested",
              href: filterLink("requested"),
              count: requestedCount,
            },
            {
              id: "confirmed",
              label: "Confirmed",
              href: filterLink("confirmed"),
              count: confirmedCount,
            },
            { id: "done", label: "Done", href: filterLink("done"), count: doneCount },
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
            {statusFilter === "requested"
              ? "No visits to confirm"
              : "No appointments in this filter"}
          </p>
          {statusFilter !== "all" && allCount > 0 ? (
            <Link
              href={filterLink("all")}
              className={`mt-5 inline-flex min-h-11 items-center font-medium text-[#005CCC] ${focusRingVisible}`}
            >
              Show all visits
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
                  <th className={tableHeadCellClass}>Visit</th>
                  <th className={tableHeadCellClass}>Who</th>
                  <th className={tableHeadCellClass}>Place</th>
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
                    <td className={tableCellClass}>
                      <div className="font-medium text-ink">{visitWhen(row)}</div>
                      <div className="mt-0.5 text-ink-soft">{row.service_name}</div>
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
                          message={visitWhatsAppMessage({
                            businessName,
                            name: row.caller_name,
                            service: row.service_name,
                            when: visitWhen(row) === "Time TBD" ? null : visitWhen(row),
                          })}
                        />
                      ) : null}
                    </td>
                    <td className={`${tableCellClass} text-ink-soft`}>
                      {row.address_landmark?.trim() || "Ask on the call"}
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
                          Call
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
