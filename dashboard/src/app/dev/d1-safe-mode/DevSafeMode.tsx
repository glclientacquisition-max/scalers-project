"use client";

import type { ReactNode } from "react";
import { IdentitySettings } from "@/components/identity/IdentitySettings";
import { BusinessKbBlock } from "@/components/admin/v2/BusinessKbBlock";
import type { TakeMessagesState } from "@/lib/takeMessages";
import type { TenantRow } from "@/lib/supabase";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Identity with fixture data: the switch saves after a short delay (or fails with ?fail=1). */
export function DevIdentity({ tenant, takeMessages, fail, sidebar }: { tenant: TenantRow; takeMessages: TakeMessagesState; fail: boolean; sidebar?: ReactNode }) {
  return (
    <IdentitySettings
      tenant={tenant}
      heading="Identity"
      sidebar={sidebar}
      takeMessages={takeMessages}
      saveTakeMessages={async (on) => {
        await wait(500);
        if (fail) return { ok: false, error: "Couldn't save. Check your connection and try again." };
        return { ok: true, state: { on, by: on ? "owner" : null, setAt: new Date().toISOString() } };
      }}
    />
  );
}

/** Super Admin brain block with a fixture (no fetch; Turn on / off answers in the browser). */
export function DevAdminKb({ takeMessages }: { takeMessages: TakeMessagesState }) {
  return (
    <BusinessKbBlock
      businessId="dev-cleaning"
      fixture={{
        available: true,
        liveVersion: 7,
        readyVersion: 7,
        brainTarget: "v2",
        onNewBrain: true,
        onNewBrainReason: "ready",
        items: 11,
        takeMessages,
        readiness: {
          passed: true,
          version: 7,
          checkedAt: "2026-10-28T11:20:00.000Z",
          checks: ["kb_compiled", "catalogue", "reader_finds_items", "areas", "hours", "capture_path"].map((id) => ({ id, ok: true })),
          tests: [{ name: "Price ask", ok: true }, { name: "Not offered", ok: true }],
        },
      }}
    />
  );
}
