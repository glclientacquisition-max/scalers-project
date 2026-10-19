"use client";

import { useState } from "react";
import { MembersPanel } from "@/components/MembersPanel";
import { AlertContactsList } from "@/components/AlertContactsList";
import { SettingsPageHeader, settingsConsoleClass, settingsPanelClass, settingsRailWrapClass, settingsRailClass, SettingsGroup } from "@/components/settingsUi";
import { deskMainClass, deskShellClass } from "@/components/DeskNav";
import { Button } from "@/components/ui/Button";
import type { MembersData } from "@/lib/membersLoad";
import type { TeamDirectoryEntry } from "@/lib/supabase";

const FLAGS = [
  { key: "receives_escalation", label: "Urgent" },
  { key: "receives_inbox", label: "Follow-up" },
  { key: "receives_ops", label: "Ops" },
] as const;

export function TeamFixture({ full, open }: { full: boolean; open: string }) {
  const data: MembersData = {
    members: [
      { userId: "u1", email: "yegonalvin@gmail.com", name: "", role: "owner", joinedAt: "" },
      { userId: "u2", email: "scalers.com@gmail.com", name: "Christopher Gachie", role: "admin", joinedAt: "" },
    ],
    invites: full ? [] : [{ id: "i1", email: "wanjiku.mwangi@shop.co.ke", role: "staff", state: "pending", expiresAt: "2099-01-01T00:00:00Z" }],
    seats: full ? { used: 2, included: 2, full: true, members: 2, pending: 0 } : { used: 3, included: 5, full: false, members: 2, pending: 1 },
    totals: { members: 2, invites: full ? 0 : 1 },
    limits: { members: 50, invites: 50 },
    seatOffer: null,
  };
  const [team, setTeam] = useState<TeamDirectoryEntry[]>([
    { name: "Alvin Kiprotich Yegon", role: "General manager", phone: "+254790123456", email: "yegonalvin@gmail.com", receives_escalation: true, receives_inbox: true, receives_ops: true },
    { name: "Christopher Gachie", role: "Owner", phone: "+254707654321", email: "scalers.com@gmail.com", receives_escalation: true, receives_inbox: false, receives_ops: true },
  ]);
  return (
    <div className={deskShellClass}>
      <div className="hidden w-[72px] shrink-0 border-r border-hairline bg-surface md:block" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-12 shrink-0 border-b border-line bg-surface" />
        <main className={deskMainClass}>
          <div className="w-full min-w-0" data-settings-console="">
            <div className={settingsConsoleClass}>
              <div className={settingsRailWrapClass}>
                <div className={settingsRailClass}>
                  <SettingsGroup title="Business">
                    {["Identity", "Hours", "Locations", "Policies"].map((x) => (
                      <div key={x} className="flex min-h-11 items-center px-4 text-body text-ink">{x}</div>
                    ))}
                  </SettingsGroup>
                </div>
              </div>
              <div className={`${settingsPanelClass} space-y-4`}>
                <SettingsPageHeader businessName="Demo" lineLive={false} title="Team" action={<Button>Save</Button>} />
                <div className="min-w-0 w-full max-w-2xl space-y-4">
                  <MembersPanel data={data} viewerRole="owner" viewerId="u1" />
                  <AlertContactsList
                    team={team}
                    flags={FLAGS}
                    note="Channels follow How we notify."
                    addLabel="Add person"
                    onChange={(i, k, v) => setTeam((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)))}
                    onAdd={() => setTeam((p) => [...p, { name: "", role: "", phone: "", email: "" }])}
                    onRemove={(i) => setTeam((p) => p.filter((_, j) => j !== i))}
                  />
                  {open === "spacer" ? <div className="h-[1200px]" /> : null}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
