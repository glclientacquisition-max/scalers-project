"use client";

import { Segmented } from "@/components/ui/Segmented";
import { useInboxPileNav } from "@/components/InboxPileNav";
import { canClientSwitchPile } from "@/lib/inboxSwipe";

export type InboxFilterPillItem = {
  id: string;
  label: string;
  href: string;
  count?: number;
};

/**
 * URL-driven pile and list filters. Underline Segmented, same control on Inbox and Contacts.
 */
export function InboxFilterPills({
  label,
  items,
  active,
}: {
  label: string;
  items: readonly InboxFilterPillItem[];
  active: string;
}) {
  // Inside the Inbox list the loaded items are already on the client: a chip
  // tap filters them at once and syncs the URL (same path as a swipe). Without
  // the old full prefetch, a plain Link waited on a full server inbox render
  // and kept showing the previous pile's rows meanwhile (preview, 18 Oct).
  const nav = useInboxPileNav();
  const current = nav?.purpose ?? active;
  return (
    <Segmented
      label={label}
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        href: item.href,
        count: item.count,
        active: current === item.id,
      }))}
      onNavigate={
        nav
          ? (key) => {
              const href = items.find((item) => item.id === key)?.href;
              if (!canClientSwitchPile(key, href, nav.hrefs, nav.listMode)) return false;
              nav.goPile(key);
              return true;
            }
          : undefined
      }
    />
  );
}
