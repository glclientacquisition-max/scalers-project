import Link from "next/link";
import { AddContactPanel } from "@/components/AddContactPanel";
import { ContactPhoneRow, ContactTableRow } from "@/components/ContactListRow";
import {
  ContactQuickPhoneRow,
  ContactQuickTableRow,
} from "@/components/ContactQuickRow";
import { ContactsSearch } from "@/components/ContactsSearch";
import { PhonebookImportButton } from "@/components/PhonebookImportButton";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskBack } from "@/components/ui/DeskBack";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import {
  deskEmptyClass,
  deskListTitleClass,
  deskShiftClass,
  pageTitleClass,
} from "@/components/ui/deskChrome";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import {
  contactsHref,
  loadContactsPage,
  resolveContactSavedFilter,
  resolveContactSort,
  type ContactSavedFilter,
} from "@/lib/contactsLoad";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function emptyCopy(saved: ContactSavedFilter, q: string): string {
  if (q) return "No matches";
  if (saved === "saved") return "No named callers";
  if (saved === "unsaved") return "No unnamed callers";
  if (saved === "recent") return "No recent calls";
  return "No callers";
}

function pileTitle(saved: ContactSavedFilter): string {
  if (saved === "recent") return "Recent calls";
  if (saved === "unsaved") return "Unsaved";
  return "Contacts";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page || "1", 10) || 1);
  const saved = resolveContactSavedFilter(sp.saved);
  const sort = resolveContactSort(sp.sort);
  const q = sanitizeSearchQuery(sp.q);
  const nested = saved === "recent" || saved === "unsaved";
  const showQuick = saved === "all" && !q;

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
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
    saved,
    { q, sort }
  );

  if (error) {
    return <DeskError>Could not load contacts.</DeskError>;
  }

  const listParams = {
    saved: saved === "all" ? undefined : saved,
    sort: sort === "recent" ? undefined : sort,
    q: q || undefined,
  };

  return (
    <div className="min-w-0 overflow-x-clip">
      <header className="space-y-3">
        {nested ? (
          <DeskBack href={contactsHref({ sort, q: q || undefined })}>Contacts</DeskBack>
        ) : (
          <h1 className={deskListTitleClass}>Contacts</h1>
        )}
        <DeskIndexLead
          status={nested ? <h1 className={pageTitleClass}>{pileTitle(saved)}</h1> : undefined}
        >
          <div className="flex w-full min-w-0 flex-col gap-2 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <ContactsSearch q={q} saved={saved} sort={sort} />
            </div>
            <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-end gap-2">
              <Link
                href="/contacts/import"
                className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Import CSV
              </Link>
              <PhonebookImportButton />
              <AddContactPanel />
            </div>
          </div>
        </DeskIndexLead>
        <FilterTabs
          label="Sort contacts"
          active={sort}
          items={[
            {
              id: "recent",
              label: "Recent",
              href: contactsHref({ saved, q: q || undefined, sort: "recent" }),
            },
            {
              id: "name",
              label: "Name",
              href: contactsHref({ saved, q: q || undefined, sort: "name" }),
            },
          ]}
        />
      </header>

      {rows.length === 0 && !showQuick ? (
        <div className={deskEmptyClass}>
          <p className="font-display text-2xl tracking-tight text-ink">
            {emptyCopy(saved, q)}
          </p>
          {q ? (
            <Link
              href={contactsHref({ saved, sort })}
              className={`mt-6 inline-flex font-medium text-ink-soft ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
            >
              Clear
            </Link>
          ) : saved === "all" &&
            String(tenant.sautikit_virtual_number || "").startsWith("pending:") ? (
            <p className="mt-2 text-sm text-ink-soft">Number being assigned</p>
          ) : saved === "all" && tenant.sautikit_virtual_number ? (
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
              Call{" "}
              <a
                href={`tel:${tenant.sautikit_virtual_number}`}
                className="font-medium text-accent-deep underline decoration-accent/40 underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {tenant.sautikit_virtual_number}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <DeskLandScope
            ids={rows.map((row) => row.id)}
            scopeKey={`${saved}:${sort}:${q}:${page}`}
          >
            <ul className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface md:mt-8 md:hidden">
              {showQuick ? (
                <>
                  <ContactQuickPhoneRow
                    kind="recent"
                    href={contactsHref({ saved: "recent", sort, q: q || undefined })}
                  />
                  <ContactQuickPhoneRow
                    kind="unsaved"
                    href={contactsHref({ saved: "unsaved", sort, q: q || undefined })}
                  />
                </>
              ) : null}
              {rows.map((row) => (
                <ContactPhoneRow key={row.id} row={row} />
              ))}
            </ul>
            <div className="mt-6 hidden min-w-0 md:mt-8 md:block">
              <DeskDataTable minWidthClass="min-w-0">
                <thead className="border-b border-line bg-surface-muted/60 text-ink-soft">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-5 lg:py-4"
                    >
                      Name
                    </th>
                    <th
                      scope="col"
                      className="hidden px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:table-cell lg:px-5 lg:py-4"
                    >
                      Phone
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 text-xs font-semibold uppercase tracking-[0.14em] lg:px-5 lg:py-4"
                    >
                      Last call
                    </th>
                    <th scope="col" className="w-px px-3 py-3 lg:px-5 lg:py-4">
                      <span className="sr-only">Call and WhatsApp</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {showQuick ? (
                    <>
                      <ContactQuickTableRow
                        kind="recent"
                        href={contactsHref({ saved: "recent", sort, q: q || undefined })}
                        colSpan={4}
                      />
                      <ContactQuickTableRow
                        kind="unsaved"
                        href={contactsHref({ saved: "unsaved", sort, q: q || undefined })}
                        colSpan={4}
                      />
                    </>
                  ) : null}
                  {rows.map((row) => (
                    <ContactTableRow key={row.id} row={row} />
                  ))}
                </tbody>
              </DeskDataTable>
            </div>
          </DeskLandScope>
          {rows.length === 0 ? (
            <div className={deskEmptyClass}>
              <p className="font-display text-2xl tracking-tight text-ink">
                {emptyCopy(saved, q)}
              </p>
              {saved === "all" &&
              String(tenant.sautikit_virtual_number || "").startsWith("pending:") ? (
                <p className="mt-2 text-sm text-ink-soft">Number being assigned</p>
              ) : saved === "all" && tenant.sautikit_virtual_number ? (
                <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
                  Call{" "}
                  <a
                    href={`tel:${tenant.sautikit_virtual_number}`}
                    className="font-medium text-accent-deep underline decoration-accent/40 underline-offset-2 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {tenant.sautikit_virtual_number}
                  </a>
                </p>
              ) : null}
            </div>
          ) : (
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              href="/contacts"
              params={listParams}
            />
          )}
        </>
      )}
    </div>
  );
}
