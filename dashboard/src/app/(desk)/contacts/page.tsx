import Link from "next/link";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { formatCallWhenRelative } from "@/lib/callsTriage";
import { loadContactsPage } from "@/lib/contactsLoad";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);

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

  const { rows, total, error } = await loadContactsPage(
    workspace.client,
    tenant.id,
    page,
    PAGE_SIZE
  );

  if (error) {
    return (
      <div className="rounded-2xl border border-warn/40 bg-white p-6 text-warn">
        Could not load contacts: {error}
        {/relation|contacts/i.test(error) ? (
          <p className="mt-2 text-sm text-ink-soft">
            Apply docs/supabase/contacts_and_requests.sql in Supabase if you have not yet.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-3xl tracking-tight text-ink sm:text-4xl">
        Contacts
      </h1>

      {rows.length === 0 ? (
        <div className="mt-8 border-y border-line py-12 text-center">
          <p className="font-display text-2xl tracking-tight text-ink">No contacts</p>
        </div>
      ) : (
        <>
          <div className="mt-8">
            <DeskDataTable minWidthClass="min-w-[720px]">
              <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                <tr>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    Phone
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    Last reason
                  </th>
                  <th
                    scope="col"
                    className="px-5 py-4 text-xs font-semibold uppercase tracking-[0.14em]"
                  >
                    Last contact
                  </th>
                  <th scope="col" className="px-5 py-4">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="group border-t border-line/70 transition duration-150 hover:bg-[#0096FF]/[0.04]"
                  >
                    <td className="px-5 py-5 align-top">
                      <p className="text-base font-semibold tracking-tight text-ink">
                        {row.name?.trim() || "Unknown"}
                      </p>
                    </td>
                    <td className="px-5 py-5 align-top font-mono text-sm text-ink">
                      {row.phone || "No phone"}
                    </td>
                    <td className="px-5 py-5 align-top text-sm text-ink-soft">
                      {row.last_reason?.trim() || "None"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-5 align-top text-sm text-ink-soft">
                      {row.lastContactAt
                        ? formatCallWhenRelative(row.lastContactAt)
                        : "None"}
                    </td>
                    <td className="px-5 py-5 align-top text-right">
                      <Link
                        href={`/contacts/${row.id}`}
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-[#005CCC] transition duration-150 hover:text-[#004a99] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DeskDataTable>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href="/contacts"
          />
        </>
      )}
    </div>
  );
}
