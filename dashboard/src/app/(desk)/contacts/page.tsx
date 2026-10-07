import { Suspense } from "react";
import { AddContactPanel } from "@/components/AddContactPanel";
import { ContactsPullHost } from "@/components/ContactsEndlessList";
import { ContactsSearch } from "@/components/ContactsSearch";
import { ContactsMobileIdRedirect } from "@/components/ContactsMobileIdRedirect";
import {
  ContactPersonFilePane,
  ContactsSplitPlaceholder,
} from "@/components/ContactPersonFilePane";
import { createWorkspaceDataClient, getCurrentTenant } from "@/lib/tenant";
import { DeskError } from "@/components/ui/DeskError";
import { DeskNoWorkspace } from "@/components/ui/DeskNoWorkspace";
import { InboxFilterPills } from "@/components/InboxFilterPills";
import { Empty } from "@/components/ui/Empty";
import { ButtonLink } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { DEFAULT_PAGE_SIZE } from "@/lib/listPage";
import { DeskLoadError } from "@/components/ui/DeskLoadError";
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
import { sanitizeSearchQuery } from "@/lib/callsTriage";

import { DeskPageGate } from "@/components/DeskPageGate";

const PAGE_SIZE = DEFAULT_PAGE_SIZE;

function emptyCopy(saved: ContactSavedFilter, q: string): string {
  if (q) return "No matches";
  if (saved === "saved") return "No named callers";
  if (saved === "unsaved") return "No unnamed callers";
  if (saved === "recent") return "No recent calls";
  if (saved === "favourite") return "No favourites";
  if (saved === "all") return "No callers";
  return "No recent calls";
}

type ContactsPageProps = {
  searchParams: Promise<{
    saved?: string;
    sort?: string;
    q?: string;
    id?: string;
    history?: string;
    hq?: string;
  }>;
};

export default function ContactsPage(props: ContactsPageProps) {
  return (
    <DeskPageGate>
      <ContactsBody {...props} />
    </DeskPageGate>
  );
}

async function ContactsBody({ searchParams }: ContactsPageProps) {
  const sp = await searchParams;
  const saved = resolveContactSavedFilter(sp.saved);
  const sort = resolveContactSort(sp.sort);
  const q = sanitizeSearchQuery(sp.q);
  const selectedId = String(sp.id || "").trim() || null;

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

  const listColumn = (
    <div className="min-w-0 space-y-4">
      <PageHeader
        title="Contacts"
        meta={`${total} people`}
        action={<AddContactPanel />}
      />
      <div className="flex w-full min-w-0 flex-row items-center gap-2">
        <div className="min-w-0 flex-1">
          <ContactsSearch q={q} saved={saved} sort={sort} selectedId={selectedId} />
        </div>
      </div>
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
        <ContactSortSelect saved={saved} sort={sort} q={q} selectedId={selectedId} />
      </div>

      <ContactsPullHost
        seed={rows}
        total={total}
        saved={saved}
        sort={sort}
        q={q}
        selectedId={selectedId}
        empty={
          <Empty
            title={emptyCopy(saved, q)}
            action={
              q ? (
                <ButtonLink href={contactsHref({ saved, sort })} variant="ghost">
                  Clear
                </ButtonLink>
              ) : saved !== "all" ? (
                <ButtonLink href={contactsHref({ saved: "all", sort })} variant="ghost">
                  Show all
                </ButtonLink>
              ) : (
                <ButtonLink href="/contacts/import" variant="primary">
                  Import
                </ButtonLink>
              )
            }
          />
        }
      />
    </div>
  );

  return (
    <div className="min-w-0 overflow-x-clip bg-canvas">
      {selectedId ? (
        <ContactsMobileIdRedirect id={selectedId} saved={saved} sort={sort} q={q} />
      ) : null}
      <div className="lg:grid lg:grid-cols-12 lg:items-start lg:gap-6">
        <div className={selectedId ? "min-w-0 max-lg:hidden lg:col-span-5" : "min-w-0 lg:col-span-5"}>
          {listColumn}
        </div>
        <div className="min-w-0 lg:col-span-7">
          {selectedId ? (
            <Suspense fallback={<ContactsSplitPlaceholder />}>
              <ContactPersonFilePane
                tenantId={tenant.id}
                vertical={tenant.vertical}
                client={workspace.client}
                contactId={selectedId}
                listSaved={sp.saved}
                listSort={sp.sort}
                listQ={sp.q}
                historyRaw={sp.history}
                hqRaw={sp.hq}
              />
            </Suspense>
          ) : (
            <ContactsSplitPlaceholder />
          )}
        </div>
      </div>
    </div>
  );
}
