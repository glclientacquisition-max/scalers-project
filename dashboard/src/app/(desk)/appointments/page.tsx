import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { AppointmentStatusToggle } from "@/components/AppointmentStatusToggle";
import { WhatsAppLink } from "@/components/WhatsAppLink";

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
      <div className="mx-auto max-w-3xl px-4 py-16">
        <p className="text-[var(--ink-soft)]">Sign in to view appointments.</p>
      </div>
    );
  }

  const params = (await searchParams) || {};
  const statusFilter = String(
    Array.isArray(params.status) ? params.status[0] : params.status || "requested"
  )
    .trim()
    .toLowerCase();

  const workspace = await createWorkspaceDataClient();
  let rows: AppointmentRow[] = [];
  let loadError: string | null = null;

  if (workspace) {
    let query = workspace.client
      .from("appointments")
      .select(
        "id, created_at, service_name, status, when_text, address_landmark, notes, caller_name, caller_phone, call_id"
      )
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    const { data, error } = await query;

    if (error) {
      loadError = /appointments|relation/i.test(error.message)
        ? `${error.message} Apply docs/supabase/appointments.sql in Supabase.`
        : error.message;
    } else {
      rows = (data || []) as AppointmentRow[];
    }
  }

  const requestedCount = rows.filter((r) => r.status === "requested").length;

  const filterLink = (status: string) => {
    const q = new URLSearchParams();
    if (status && status !== "requested") q.set("status", status);
    if (status === "all") q.set("status", "all");
    const s = q.toString();
    return s ? `/appointments?${s}` : "/appointments";
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-[var(--ink)]">
            Appointments
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            Visit requests your receptionist booked from home-services calls.
          </p>
        </div>
        <div className="rounded-2xl border border-line bg-surface px-5 py-3">
          <p className="text-xs uppercase tracking-wide text-[var(--ink-soft)]">
            In this list
          </p>
          <p className="font-display text-2xl text-[var(--ink)]">
            {statusFilter === "requested" ? requestedCount : rows.length}
          </p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ["requested", "Requested"],
            ["confirmed", "Confirmed"],
            ["done", "Done"],
            ["cancelled", "Cancelled"],
            ["all", "All"],
          ] as const
        ).map(([id, label]) => (
          <Link
            key={id}
            href={filterLink(id)}
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

      {loadError ? (
        <p className="mt-8 rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-[var(--warn)]">
          {loadError}
        </p>
      ) : null}

      {!loadError && rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-line bg-surface px-6 py-10 text-center">
          <p className="text-[var(--ink)] font-medium">
            No appointments in this filter
          </p>
          <p className="mt-2 text-sm text-[var(--ink-soft)]">
            When a caller books a visit, it appears here. Set vertical to{" "}
            <span className="font-medium text-[var(--ink)]">Home services</span>{" "}
            in{" "}
            <Link href="/settings#train" className="text-[var(--accent)] hover:underline">
              Business
            </Link>{" "}
            and train your services catalogue.
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
                  {row.status} · {formatWhen(row.created_at)}
                </p>
                <p className="mt-1 font-medium text-[var(--ink)]">
                  {row.caller_name || "Caller"}
                  <span className="font-normal text-[var(--ink-soft)]">
                    {" "}
                    — {row.service_name}
                  </span>
                </p>
                {row.when_text ? (
                  <p className="mt-1 text-sm text-[var(--ink)]">
                    When: {row.when_text}
                  </p>
                ) : null}
                {row.address_landmark ? (
                  <p className="mt-1 text-sm text-[var(--ink)]">
                    Where: {row.address_landmark}
                  </p>
                ) : null}
                {row.notes ? (
                  <p className="mt-1 text-sm text-[var(--ink-soft)]">{row.notes}</p>
                ) : null}
              </div>
              <AppointmentStatusToggle id={row.id} status={row.status} />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              {row.caller_phone ? (
                <WhatsAppLink number={row.caller_phone} label="WhatsApp caller" />
              ) : null}
              {row.call_id ? (
                <Link href="/calls" className="text-[var(--accent)] hover:underline">
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
