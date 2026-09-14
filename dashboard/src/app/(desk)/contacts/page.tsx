import Link from "next/link";
import { AddContactPanel } from "@/components/AddContactPanel";
import { PhonebookImportButton } from "@/components/PhonebookImportButton";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskError } from "@/components/ui/DeskError";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { deskEmptyClass, pageTitleClass } from "@/components/ui/deskChrome";
import { formatCallWhenRelative } from "@/lib/callsTriage";
import {
  contactsHref,
  loadContactsPage,
  resolveContactSavedFilter,
  type ContactSavedFilter,
} from "@/lib/contactsLoad";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

const SAVED_FILTERS: { id: ContactSavedFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "saved", label: "Saved" },
  { id: "unsaved", label: "Unsaved" },
];

function emptyCopy(saved: ContactSavedFilter): string {
  if (saved === "saved") return "No named callers";
  if (saved === "unsaved") return "No unnamed callers";
  return "No callers";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const saved = resolveContactSavedFilter(sp.saved);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-6 text-ink-soft">
        No workspace linked to this account yet.{" "}
        <Link href="/signup" className="text-[#005CCC]">
          Create one
        </Link>
        .
      </div>
    );
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const { rows, total, error } = await loadContactsPage(
    workspace.client,
    tenant.id,
    page,
    PAGE_SIZE,
    saved
  );

  if (error) {
    return <DeskError>Could not load contacts.</DeskError>;
  }

  return (
    <div>
      <header className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className={pageTitleClass}>
              Contacts
            </h1>
            {total > 0 ? (
              <p className="mt-1 text-[13px] text-ink-soft">
                {total} {total === 1 ? "caller" : "callers"}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/contacts/import"
              className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-[#005CCC] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
            >
              Import CSV
            </Link>
            <PhonebookImportButton />
            <AddContactPanel />
          </div>
        </div>
        <FilterTabs
          label="Filter by name"
          active={saved}
          items={SAVED_FILTERS.map((item) => ({
            id: item.id,
            label: item.label,
            href: contactsHref({ saved: item.id }),
          }))}
        />
      </header>

      {rows.length === 0 ? (
        <div className={deskEmptyClass}>
          <p className="font-display text-2xl tracking-tight text-ink">
            {emptyCopy(saved)}
          </p>
          {saved === "all" &&
          String(tenant.sautikit_virtual_number || "").startsWith("pending:") ? (
            <p className="mt-2 text-sm text-ink-soft">Number being assigned</p>
          ) : saved === "all" && tenant.sautikit_virtual_number ? (
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
              Call{" "}
              <a
                href={`tel:${tenant.sautikit_virtual_number}`}
                className="font-medium text-[#005ccc] underline decoration-[#0096FF]/40 underline-offset-2 hover:text-[#0096FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0096FF]"
              >
                {tenant.sautikit_virtual_number}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {rows.map((row) => (
              <li key={row.id} className="border-t border-line/70 first:border-t-0">
                <Link
                  href={`/contacts/${row.id}`}
                  aria-label={row.name?.trim() || "Contact"}
                  className="block px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0096FF]"
                >
                  <p className="text-base font-semibold tracking-tight text-ink">
                    {row.name?.trim() || "Unknown"}
                  </p>
                  <p className="mt-1 font-mono text-sm text-ink">{row.phone || "No phone"}</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {row.lastReasonDisplay || "None"}
                    {row.lastContactAt ? ` · ${formatCallWhenRelative(row.lastContactAt)}` : ""}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-8 hidden md:block">
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
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className="group relative cursor-pointer border-t border-line/70 transition duration-150 hover:bg-[#0096FF]/[0.04]"
                  >
                    <td className="px-5 py-5 align-top">
                      <DeskRowHit href={`/contacts/${row.id}`} label={row.name?.trim() || "Contact"} />
                      <p className={`${deskRowMutedClass} text-base font-semibold tracking-tight text-ink`}>
                        {row.name?.trim() || "Unknown"}
                      </p>
                    </td>
                    <td className={`${deskRowMutedClass} px-5 py-5 align-top font-mono text-sm text-ink`}>
                      {row.phone || "No phone"}
                    </td>
                    <td className={`${deskRowMutedClass} px-5 py-5 align-top text-sm text-ink-soft`}>
                      {row.lastReasonDisplay || "None"}
                    </td>
                    <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-5 align-top text-sm text-ink-soft`}>
                      {row.lastContactAt
                        ? formatCallWhenRelative(row.lastContactAt)
                        : "None"}
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
            params={{ saved: saved === "all" ? undefined : saved }}
          />
        </>
      )}
    </div>
  );
}
