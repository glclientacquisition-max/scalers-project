"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { revalidateLiveTicket } from "@/app/(desk)/liveInboxActions";
import { liveTicketFilter } from "@/lib/deskFresh";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 1200;

/**
 * Refresh the open ticket when its transcript changes.
 * Mounted on the ticket only. Does not move the owner to another route.
 * Scroll place is kept by the thread pin.
 */
export function LiveTicket({ callId }: { callId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    const filter = liveTicketFilter(callId);
    if (!filter) return;

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
      void revalidateLiveTicket(callId)
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

    let channel: ReturnType<typeof supabase.channel> | null = null;

    const start = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || !data.session) return;

      channel = supabase
        .channel(`desk-ticket-${callId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "transcripts",
            filter,
          },
          scheduleRefresh
        );
      channel.subscribe();
    };

    void start();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [callId]);

  return null;
}
