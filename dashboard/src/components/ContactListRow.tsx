"use client";

import { CallLink } from "@/components/CallLink";
import { WhatsAppLink } from "@/components/WhatsAppLink";
import { ContactNameForm } from "@/components/ContactNameForm";
import { Avatar } from "@/components/ui/Avatar";
import { ListRow } from "@/components/ui/ListRow";
import { formatCallWhenRelative } from "@/lib/callsTriage";
import { cx } from "@/lib/cx";
import {
  contactListSubline,
  contactListTitle,
  contactsSplitHref,
  contactProfileHref,
  isUnsavedContactName,
  type ContactListRow as ContactListRowData,
  type ContactSavedFilter,
  type ContactSort,
} from "@/lib/contactsLoad";
import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";

function subscribeDesktopSplit(onStoreChange: () => void) {
  const mq = window.matchMedia("(min-width: 1024px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function desktopSplitQuery() {
  return window.matchMedia("(min-width: 1024px)").matches;
}

function serverDesktopSplit() {
  return false;
}

function ContactListDock({ phone }: { phone: string | null }) {
  const number = String(phone || "").trim();
  if (!number) return null;
  return (
    <>
      <CallLink number={number} />
      <WhatsAppLink number={number} variant="icon" />
    </>
  );
}

function lastCallStamp(row: ContactListRowData): string | null {
  return row.lastContactAt ? formatCallWhenRelative(row.lastContactAt) : null;
}

export function ContactPhoneRow({
  row,
  saved,
  sort,
  q,
  selectedId,
}: {
  row: ContactListRowData;
  saved: ContactSavedFilter;
  sort: ContactSort;
  q: string;
  selectedId?: string | null;
}) {
  const router = useRouter();
  const desktopSplit = useSyncExternalStore(
    subscribeDesktopSplit,
    desktopSplitQuery,
    serverDesktopSplit
  );
  const title = contactListTitle(row);
  const subline = contactListSubline(row);
  const lastCall = lastCallStamp(row);
  const unsaved = isUnsavedContactName(row.name);
  const listReturn = { saved, sort, q: q || undefined };
  const href = desktopSplit
    ? contactsSplitHref(row.id, listReturn)
    : contactProfileHref(row.id, listReturn);
  const selected = selectedId === row.id;

  const onOpen = useCallback(() => {
    router.push(href);
  }, [href, router]);

  return (
    <ListRow
      id={row.id}
      href={desktopSplit ? undefined : href}
      onOpen={desktopSplit ? onOpen : undefined}
      ariaLabel={title}
      leading={<Avatar name={row.name} size={40} />}
      title={title}
      preview={
        unsaved ? (
          <span className="flex min-w-0 flex-col gap-2">
            <span className="truncate">{subline}</span>
            <ContactNameForm contactId={row.id} initialName={row.name} variant="row" />
          </span>
        ) : (
          subline
        )
      }
      when={lastCall}
      actions={<ContactListDock phone={row.phone} />}
      className={cx(selected && "bg-accent-tonal/40 ring-1 ring-inset ring-brand/30")}
    />
  );
}
