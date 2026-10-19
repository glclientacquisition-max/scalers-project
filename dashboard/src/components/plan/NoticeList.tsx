"use client";

import { useState } from "react";
import { ListRow } from "@/components/ui/ListRow";
import { nairobiDay } from "@/lib/billingBanner";
import { markBillingNoticeRead } from "@/app/(desk)/settings/billing/billingActions";
import type { OwnerNoticeRow } from "@/lib/ownerPlanLoad";

export function NoticeList({ notices }: { notices: OwnerNoticeRow[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [read, setRead] = useState<Record<string, boolean>>({});

  if (notices.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-title text-ink">Notices</h2>
      <ul className="mt-3 overflow-hidden rounded-2xl border border-hairline">
        {notices.map((notice) => {
          const unread = notice.unread && !read[notice.id];
          const open = openId === notice.id;
          return (
            <ListRow
              key={notice.id}
              title={notice.title}
              when={unread ? "Unread" : nairobiDay(notice.createdAt) || ""}
              unread={unread}
              onOpen={() => {
                setOpenId(open ? null : notice.id);
                if (unread) {
                  setRead((prev) => ({ ...prev, [notice.id]: true }));
                  void markBillingNoticeRead(notice.id);
                }
              }}
              below={open ? <p className="text-body text-ink-2">{notice.body}</p> : undefined}
            />
          );
        })}
      </ul>
    </section>
  );
}
