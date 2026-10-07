"use client";

import { Segmented } from "@/components/ui/Segmented";

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
  return (
    <Segmented
      label={label}
      items={items.map((item) => ({
        key: item.id,
        label: item.label,
        href: item.href,
        count: item.count,
        active: active === item.id,
      }))}
    />
  );
}
