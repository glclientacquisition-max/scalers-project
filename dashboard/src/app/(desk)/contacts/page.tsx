import Link from "next/link";
import { redirect } from "next/navigation";
import { AddContactPanel } from "@/components/AddContactPanel";
import { ContactPhoneRow, ContactTableRow } from "@/components/ContactListRow";
import { ContactsSearch } from "@/components/ContactsSearch";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { DeskLandScope } from "@/components/ui/DeskLand";
import { Pagination } from "@/components/ui/Pagination";
import { clampListPage, DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import {
  deskEmptyClass,
  deskListTitleClass,
  deskShiftClass,
} from "@/components/ui/deskChrome";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import { ContactSortSelect } from "@/components/ContactSortSelect";
import {
  contactFilterPills,
  contactProfileHref,
  contactsHref,
  loadContactPileCounts,
  loadContactsPage,
  resolveContactSavedFilter,
  resolveContactSort,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function emptyCopy(saved: ContactSavedFilter, q: string): string {
  if (q) return "No matches";
  if (saved === "saved") return "No named callers";
  if (saved === "unsaved") return "No unnamed callers";
  if (saved === "recent") return "No recent calls";
  if (saved === "favourite") return "No favourites";
  return "No callers";
}

function listQuery(
  saved: ContactSavedFilter,
  sort: ContactSort,
  q: string
) {
  return {
    saved,
    sort,
    q: q || undefined,
  };
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
  const query = listQuery(saved, sort, q);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const [{ rows, total, error }, piles] = await Promise.all([
    loadContactsPage(workspace.client, tenant.id, page, PAGE_SIZE, saved, {
      q,
      sort,
    }),
    loadContactPileCounts(workspace.client, tenant.id),
  ]);

  if (error) {
    return <DeskError>Could not load contacts.</DeskError>;
  }

  const safePage = clampListPage(page, total, PAGE_SIZE);
  if (safePage !== page) {
    redirect(contactsHref({ saved, sort, q, page: safePage }));
  }

  const listParams = {
    saved: saved === "all" ? undefined : saved,
    sort: sort === "recent" ? undefined : sort,
    q: q || undefined,
  };
  const listReturn = { ...query, page };

  return (
    <div className="min-w-0 overflow-x-clip">
      <header className="space-y-3">
        <div className="flex min-w-0 items-end justify-between gap-3">
          <h1 className={deskListTitleClass}>Contacts</h1>
          <p className="pb-1 text-sm tabular-nums text-ink-soft">{total} people</p>
        </div>
        <DeskIndexLead>
          <div className="flex w-full min-w-0 flex-row items-center gap-2">
            <div className="min-w-0 flex-1">
              <ContactsSearch q={q} saved={saved} sort={sort} />
            </div>
            <div className="shrink-0">
              <AddContactPanel />
            </div>
          </div>
        </DeskIndexLead>
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <InboxFilterPills
              label="Filter contacts"
              active={saved}
              items={contactFilterPills({
                sort,
                q: q || undefined,
                recents: piles.recents,
                favourites: piles.favourites,
                unsaved: piles.unsaved,
              })}
            />
          </div>
          <ContactSortSelect saved={saved} sort={sort} q={q} />
        </div>
      </header>

      {rows.length === 0 ? (
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
              {rows.map((row) => (
                <ContactPhoneRow
                  key={row.id}
                  row={row}
                  href={contactProfileHref(row.id, listReturn)}
                />
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
                  {rows.map((row) => (
                    <ContactTableRow
                      key={row.id}
                      row={row}
                      href={contactProfileHref(row.id, listReturn)}
                    />
                  ))}
                </tbody>
              </DeskDataTable>
            </div>
          </DeskLandScope>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            href="/contacts"
            params={listParams}
          />
        </>
      )}
    </div>
  );
}
