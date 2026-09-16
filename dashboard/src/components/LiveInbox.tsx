"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { revalidateLiveDesk } from "@/app/(desk)/liveInboxActions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LIVE_TABLES = ["calls", "service_requests", "appointments"] as const;
const REFRESH_DEBOUNCE_MS = 1200;

/**
 * Silent live updates for desk lists. Mounted once in the desk shell so
 * leaving Inbox does not drop the subscription. Waits for an owner JWT
 * before subscribe (Realtime RLS). Debounces insert plus terminal update
 * into one refresh. revalidatePath keeps /calls and /home fresh when the
 * current route is elsewhere. Visibility and focus refetch catch events
 * dropped while the tab was hidden.
 */
export function LiveInbox({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    let cancelled = false;
    let flushing = false;
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    const flush = () => {
      if (flushing || cancelled) return;
      flushing = true;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      void revalidateLiveDesk()
        .catch(() => undefined)
        .finally(() => {
          flushing = false;
          if (!cancelled) routerRef.current.refresh();
        });
    };

    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, REFRESH_DEBOUNCE_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") flush();
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
          scheduleRefresh
        );
      }
      channel = next;
      channel.subscribe();
    };

    void start();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      if (channel) supabase.removeChannel(channel);
    };
  }, [tenantId]);

  return null;
}
