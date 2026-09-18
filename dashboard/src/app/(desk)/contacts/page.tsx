import Link from "next/link";
import { AddContactPanel } from "@/components/AddContactPanel";
import { PhonebookImportButton } from "@/components/PhonebookImportButton";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskDataTable } from "@/components/ui/DeskDataTable";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { FilterTabs } from "@/components/ui/FilterTabs";
import { DeskRowHit, deskRowMutedClass } from "@/components/ui/deskRowHit";
import { RowIdentity } from "@/components/ui/deskRow";
import { DeskLandScope, DeskLandSurface } from "@/components/ui/DeskLand";
import { DEFAULT_PAGE_SIZE, Pagination } from "@/components/ui/Pagination";
import { deskEmptyClass, deskPreviewCellClass, deskPreviewClass, deskShiftClass, pageTitleClass } from "@/components/ui/deskChrome";
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
              className="inline-flex min-h-11 items-center px-3 text-sm font-medium text-accent-deep hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
            scopeKey={`${saved}:${page}`}
          >
          <ul className="mt-8 overflow-hidden rounded-2xl border border-line bg-surface md:hidden">
            {rows.map((row) => (
              <DeskLandSurface
                as="li"
                key={row.id}
                id={row.id}
                className="relative border-t border-line/70 first:border-t-0"
              >
                <Link
                  href={`/contacts/${row.id}`}
                  aria-label={row.name?.trim() || "Contact"}
                  className="flex items-center gap-3 px-4 py-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <RowIdentity name={row.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={`min-w-0 text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                        {row.name?.trim() || "Unknown"}
                      </p>
                      {row.lastContactAt ? (
                        <p className="shrink-0 text-xs text-ink-soft">
                          {formatCallWhenRelative(row.lastContactAt)}
                        </p>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-mono text-sm text-ink">{row.phone || "No phone"}</p>
                    <p className={`mt-0.5 text-sm text-ink-soft ${deskPreviewClass}`}>
                      {row.lastReasonDisplay || "None"}
                    </p>
                  </div>
                </Link>
              </DeskLandSurface>
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
                  <DeskLandSurface
                    as="tr"
                    key={row.id}
                    id={row.id}
                    className={`group relative cursor-pointer border-t border-line/70 ${deskShiftClass} hover:bg-accent/[0.04]`}
                  >
                    <td className="px-5 py-5 align-top">
                      <DeskRowHit href={`/contacts/${row.id}`} label={row.name?.trim() || "Contact"} />
                      <div className={`${deskRowMutedClass} flex items-center gap-3`}>
                        <RowIdentity name={row.name} />
                        <p className={`min-w-0 text-base font-semibold tracking-tight text-ink ${deskPreviewClass}`}>
                          {row.name?.trim() || "Unknown"}
                        </p>
                      </div>
                    </td>
                    <td className={`${deskRowMutedClass} px-5 py-5 align-top font-mono text-sm text-ink`}>
                      {row.phone || "No phone"}
                    </td>
                    <td className={`${deskRowMutedClass} ${deskPreviewCellClass} px-5 py-5 align-top text-sm text-ink-soft`}>
                      <p className={deskPreviewClass}>{row.lastReasonDisplay || "None"}</p>
                    </td>
                    <td className={`${deskRowMutedClass} whitespace-nowrap px-5 py-5 align-top text-sm text-ink-soft`}>
                      {row.lastContactAt
                        ? formatCallWhenRelative(row.lastContactAt)
                        : "None"}
                    </td>
                  </DeskLandSurface>
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
            params={{ saved: saved === "all" ? undefined : saved }}
          />
        </>
      )}
    </div>
  );
}
