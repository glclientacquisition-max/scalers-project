import Link from "next/link";
import { AddContactPanel } from "@/components/AddContactPanel";
import { ContactsPullHost } from "@/components/ContactsEndlessList";
import { ContactsSearch } from "@/components/ContactsSearch";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import {
  btnGhost,
  btnPrimary,
  deskEmptyClass,
  deskListTitleClass,
  deskShiftClass,
} from "@/components/ui/deskChrome";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
import { DeskIndexLead } from "@/components/ui/DeskIndexLead";
import { sanitizeSearchQuery } from "@/lib/callsTriage";
import { ContactSortSelect } from "@/components/ContactSortSelect";
import {
  contactFilterPills,
  contactsHref,
  loadContactPileCounts,
  loadContactsPage,
  resolveContactSavedFilter,
  resolveContactSort,
  type ContactSavedFilter,
} from "@/lib/contactsLoad";

// instant = false: request-time desk data under the owner auth shell.
export const instant = false;

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function emptyCopy(saved: ContactSavedFilter, q: string): string {
  if (q) return "No matches";
  if (saved === "saved") return "No named callers";
  if (saved === "unsaved") return "No unnamed callers";
  if (saved === "recent") return "No recent calls";
  if (saved === "favourite") return "No favourites";
  return "No callers";
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; sort?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const saved = resolveContactSavedFilter(sp.saved);
  const sort = resolveContactSort(sp.sort);
  const q = sanitizeSearchQuery(sp.q);

  const tenant = await getCurrentTenant();
  if (!tenant) {
    return <DeskNoWorkspace />;
  }

  const workspace = await createWorkspaceDataClient();
  if (!workspace) {
    return <DeskError>Not signed in.</DeskError>;
  }

  const [{ rows, total, error }, piles] = await Promise.all([
    loadContactsPage(workspace.client, tenant.id, 1, PAGE_SIZE, saved, {
      q,
      sort,
    }),
    loadContactPileCounts(workspace.client, tenant.id),
  ]);

  if (error) {
    return <DeskLoadError>Could not load contacts.</DeskLoadError>;
  }

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
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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

      <ContactsPullHost
        seed={rows}
        total={total}
        saved={saved}
        sort={sort}
        q={q}
        empty={
          <div className={deskEmptyClass}>
            <p className="font-display text-2xl tracking-tight text-ink">
              {emptyCopy(saved, q)}
            </p>
            {q ? (
              <Link
                href={contactsHref({ saved, sort })}
                className={`mt-6 inline-flex min-h-11 items-center font-medium text-ink-soft ${deskShiftClass} hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
              >
                Clear
              </Link>
            ) : saved !== "all" ? (
              <Link href={contactsHref({ sort })} className={`${btnGhost} mt-6`}>
                Show all
              </Link>
            ) : (
              <Link href="/contacts/import" className={`${btnPrimary} mt-6`}>
                Import
              </Link>
            )}
          </div>
        }
      />
    </div>
  );
}
