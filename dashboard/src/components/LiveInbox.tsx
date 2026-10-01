"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { revalidateLiveDesk, revalidateLiveUsage } from "@/app/(desk)/liveInboxActions";
import { usageLiveWatches, usageRouteNeedsRefresh } from "@/lib/deskFresh";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LIVE_TABLES = ["calls", "service_requests", "appointments"] as const;
const REFRESH_DEBOUNCE_MS = 1200;

/**
 * Silent live updates for desk lists. Mounted once in the desk shell so
 * leaving Inbox does not drop the subscription. Waits for an owner JWT
 * before subscribe (Realtime RLS). Debounces insert plus terminal update
 * into one refresh. revalidatePath keeps /calls and /home fresh when the
 * current route is elsewhere. A tenant or ledger change also drops /wallet
 * and /home, and refreshes only while the owner is already on those screens.
 * Payment start does not call this. Returning to the tab does not reload the page.
 * Pull to refresh still does.
 */
export function LiveInbox({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routerRef = useRef(router);
  const pathRef = useRef(pathname);
  routerRef.current = router;
  pathRef.current = pathname;

  useEffect(() => {
    let cancelled = false;
    let flushing = false;
    const want = { desk: false, usage: false };
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    const flush = () => {
      if (flushing || cancelled) return;
      flushing = true;
      const desk = want.desk;
      const usage = want.usage;
      want.desk = false;
      want.usage = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const jobs: Promise<unknown>[] = [];
      if (desk) jobs.push(revalidateLiveDesk().catch(() => undefined));
      if (usage) jobs.push(revalidateLiveUsage().catch(() => undefined));
      if (jobs.length === 0) jobs.push(Promise.resolve());
      void Promise.all(jobs).finally(() => {
        flushing = false;
        if (cancelled) return;
        if (desk || (usage && usageRouteNeedsRefresh(pathRef.current))) {
          routerRef.current.refresh();
        }
      });
    };

    const scheduleRefresh = (kind?: "desk" | "usage") => {
      want[kind === "usage" ? "usage" : "desk"] = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, REFRESH_DEBOUNCE_MS);
    };

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const start = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;

      let next = supabase.channel(`desk-inbox-${tenantId}`);
      for (const table of LIVE_TABLES) {
        next = next.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `tenant_id=eq.${tenantId}`,
          },
          () => scheduleRefresh("desk")
        );
      }
      for (const watch of usageLiveWatches(tenantId)) {
        next = next.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: watch.table,
            filter: watch.filter,
          },
          () => scheduleRefresh("usage")
        );
      }
      channel = next;
      channel.subscribe();
    };

    void start();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return null;
}
