"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const LIVE_TABLES = ["calls", "service_requests", "appointments"] as const;
const REFRESH_DEBOUNCE_MS = 1200;

/**
 * Silent live updates for desk lists. Subscribes to this tenant's work-table
 * changes and re-runs the server page after a short debounce, so one call's
 * insert plus terminal update collapse into a single refresh. Without an
 * owner session (legacy mode) or the realtime publication, the channel stays
 * quiet and the page behaves exactly as refresh-to-update.
 */
export function LiveInbox({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let supabase: ReturnType<typeof createSupabaseBrowserClient>;
    try {
      supabase = createSupabaseBrowserClient();
    } catch {
      return;
    }

    const scheduleRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    let channel = supabase.channel(`desk-inbox-${tenantId}`);
    for (const table of LIVE_TABLES) {
      channel = channel.on(
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
    channel.subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [tenantId, router]);

  return null;
}
