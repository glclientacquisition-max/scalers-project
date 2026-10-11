"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
  resendInviteAction,
  revokeInviteAction,
  transferOwnershipAction,
  type MembersActionResult,
} from "@/app/(desk)/settings/membersActions";
import { ROLE_BLURBS, ROLE_LABELS, assignableRoles, canManageMember, type Role } from "@/lib/permissions";
import { daysLeft } from "@/lib/invites";
import type { MembersData } from "@/lib/membersLoad";
import { transferConfirmMatches } from "@/lib/memberConfirm";
import { INVITES_PAGE, MEMBERS_PAGE } from "@/lib/teamLimits";
import { Button } from "@/components/ui/Button";
import { ChoiceSheet } from "@/components/ui/ChoiceSheet";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { notify } from "@/components/ui/DeskNotice";
import { SettingsGroup, settingsFieldClass } from "@/components/settingsUi";

type Pending = {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  refreshAll?: boolean;
  fn: () => Promise<MembersActionResult>;
};

const rowClass = "flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5";
const linkClass =
  "flex min-h-11 items-center justify-center px-4 text-body font-medium text-accent hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

/**
 * Settings > Team & access > Members. Renders inside the Settings <form>, so there are
 * no nested forms: every action is called directly and confirmed in a drawer.
 */
export function MembersPanel({ data, viewerRole, viewerId }: { data: MembersData; viewerRole: Role; viewerId: string }) {
  const [email, setEmail] = useState("");
  const roles = assignableRoles(viewerRole);
  const [role, setRole] = useState<Role>(roles.includes("staff") ? "staff" : roles[0] || "viewer");
  const [flash, setFlash] = useState<MembersActionResult | null>(null);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const busy = useRef(false);
  const router = useRouter();
  const canInvite = roles.length > 0;
  const { seats, totals, limits } = data;

  /** Runs one action at a time and always shows the outcome: inline + desk toast (survives a re-render). */
  function run(fn: () => Promise<MembersActionResult>, opts?: { refreshAll?: boolean; onDone?: () => void }) {
    if (busy.current) return; // double-click safe
    busy.current = true;
    start(async () => {
      let result: MembersActionResult;
      try {
        result = await fn();
      } catch {
        result = { error: "Something went wrong. Nothing was changed. Try again." };
      }
      if (!result.ok && !result.error) result = { ...result, error: "Something went wrong. Try again." };
      busy.current = false;
      setFlash(result);
      notify(result.error || result.message || "Done.");
      opts?.onDone?.();
      if (result.ok) {
        setEmail("");
        // Roles changed (e.g. you're now an Admin): reload server data so nav and controls match.
        if (opts?.refreshAll) router.refresh();
      }
    });
  }

  function ask(p: Pending) {
    setTyped("");
    setConfirming(p);
  }

  function moreHref(key: "members" | "invites", next: number) {
    const params = new URLSearchParams({ tab: "train", panel: "team", members: String(limits.members), invites: String(limits.invites) });
    params.set(key, String(next));
    return `/settings?${params.toString()}`;
  }

  const roleOptions = roles.map((r) => ({ value: r, label: ROLE_LABELS[r], detail: ROLE_BLURBS[r] }));

  return (
    <div className="space-y-6" aria-busy={pending}>
      <SettingsGroup
        title="Members"
        action={
          <span className="text-meta text-ink-2" aria-label={`${seats.used} of ${seats.included} seats used`}>
            {seats.used} of {seats.included} seats
          </span>
        }
      >
        <ul aria-label="Members">
          {data.members.map((m) => {
            const self = m.userId === viewerId;
            const manageable = !self && canManageMember(viewerRole, m.role);
            const display = m.name || m.email;
            return (
              <li key={m.userId} className={`${rowClass} border-b border-hairline last:border-b-0`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-ink" title={m.email}>
                    {display}
                    {self ? <span className="text-ink-2"> (you)</span> : null}
                  </p>
                  {m.name ? <p className="truncate text-meta text-ink-2">{m.email}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {manageable ? (
                    <div className="w-32">
                      <ChoiceSheet
                        title={`Role for ${display}`}
                        label={`Role for ${m.email}`}
                        value={m.role}
                        options={roleOptions}
                        onChange={(next) => {
                          if (next !== m.role) run(() => changeMemberRoleAction(m.userId, next));
                        }}
                      />
                    </div>
                  ) : (
                    <span className="px-1 text-body text-ink-2">{ROLE_LABELS[m.role]}</span>
                  )}
                  {viewerRole === "owner" && m.role === "admin" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        ask({
                          title: `Make ${display} the owner?`,
                          confirmLabel: "Transfer ownership",
                          danger: true,
                          typeToConfirm: m.email,
                          refreshAll: true,
                          fn: () => transferOwnershipAction(m.userId),
                          body: (
                            <div className="space-y-3" data-transfer-consequences="">
                              <p>{m.email} becomes the owner straight away.</p>
                              <ul className="list-disc space-y-1.5 pl-5">
                                <li>You become an Admin. You keep the inbox, settings, usage and top-ups.</li>
                                <li>You can no longer transfer ownership. Only the new owner can, including back to you.</li>
                                <li>The new owner holds the account and its billing, and can change your role or remove you.</li>
                              </ul>
                            </div>
                          ),
                        })
                      }
                    >
                      Make owner
                    </Button>
                  ) : null}
                  {manageable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-attention"
                      disabled={pending}
                      aria-label={`Remove ${m.email}`}
                      onClick={() =>
                        ask({
                          title: `Remove ${display}?`,
                          confirmLabel: "Remove",
                          danger: true,
                          fn: () => removeMemberAction(m.userId),
                          body: <p>They lose access straight away and their seat is freed.</p>,
                        })
                      }
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {totals.members > data.members.length ? (
          <Link href={moreHref("members", limits.members + MEMBERS_PAGE)} scroll={false} className={linkClass}>
            Show more ({totals.members - data.members.length})
          </Link>
        ) : null}
      </SettingsGroup>

      {data.invites.length ? (
        <SettingsGroup title="Invited">
          <ul aria-label="Pending invites">
            {data.invites.map((i) => {
              const days = daysLeft(i.expiresAt);
              return (
                <li key={i.id} className={`${rowClass} border-b border-hairline last:border-b-0`}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink">{i.email}</p>
                    <p className="text-meta text-ink-2">
                      {ROLE_LABELS[i.role]} · expires in {days} day{days === 1 ? "" : "s"}
                    </p>
                  </div>
                  {canInvite && canManageMember(viewerRole, i.role) ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button variant="ghost" size="sm" disabled={pending} aria-label={`Resend invite to ${i.email}`} onClick={() => run(() => resendInviteAction(i.id))}>
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-attention"
                        disabled={pending}
                        aria-label={`Cancel invite to ${i.email}`}
                        onClick={() =>
                          ask({
                            title: `Cancel the invite to ${i.email}?`,
                            confirmLabel: "Cancel invite",
                            danger: true,
                            fn: () => revokeInviteAction(i.id),
                            body: <p>The link in their email stops working and the seat is freed.</p>,
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {totals.invites > data.invites.length ? (
            <Link href={moreHref("invites", limits.invites + INVITES_PAGE)} scroll={false} className={linkClass}>
              Show more ({totals.invites - data.invites.length})
            </Link>
          ) : null}
        </SettingsGroup>
      ) : null}

      {canInvite ? (
        seats.full ? (
          <SettingsGroup title="Invite">
            <div className="space-y-1 px-4 py-3 text-body">
              <p className="text-ink">All {seats.included} seats are in use.</p>
              <Link href="/wallet" className="inline-block font-medium text-accent hover:underline">
                Upgrade your package to invite more people
              </Link>
            </div>
          </SettingsGroup>
        ) : (
          <SettingsGroup title="Invite">
            <div className="px-4 py-3">
              <label className="block text-body font-medium text-ink" htmlFor="invite-email">Email</label>
              <input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  // Enter would submit the surrounding Settings form.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (email.trim()) run(() => inviteMemberAction(email, role));
                  }
                }}
                placeholder="name@business.co.ke"
                className={settingsFieldClass}
              />
            </div>
            <div className="px-3">
              <ChoiceSheet title="Role" rowLabel="Role" value={role} options={roleOptions} onChange={setRole} />
            </div>
            <p className="px-4 py-2 text-meta text-ink-2" aria-live="polite">{ROLE_BLURBS[role]}</p>
            <div className="flex justify-end px-4 py-3">
              <Button
                variant="primary"
                size="md"
                disabled={pending || !email.trim()}
                onClick={() => run(() => inviteMemberAction(email, role))}
              >
                {pending ? "Sending…" : "Send invite"}
              </Button>
            </div>
          </SettingsGroup>
        )
      ) : null}

      <p role={flash?.error ? "alert" : "status"} aria-live="polite" className={`min-h-5 px-1 text-meta ${flash?.error ? "text-attention" : "text-ink-2"}`}>
        {flash ? flash.error || flash.message : ""}
      </p>

      <p className="px-1 text-meta text-ink-2">Members sign in and use a seat. Alert contacts only get notified.</p>

      <ConfirmSheet
        open={!!confirming}
        title={confirming?.title || ""}
        confirmLabel={confirming?.confirmLabel || "Confirm"}
        danger={confirming?.danger}
        pending={pending}
        confirmDisabled={!!confirming?.typeToConfirm && !transferConfirmMatches(typed, confirming.typeToConfirm)}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const c = confirming;
          if (!c) return;
          run(c.fn, { refreshAll: c.refreshAll, onDone: () => setConfirming(null) });
        }}
      >
        {confirming?.body}
        {confirming?.typeToConfirm ? (
          <div className="mt-4">
            <label htmlFor="confirm-type" className="block text-body font-medium text-ink">
              Type {confirming.typeToConfirm} to confirm
            </label>
            <input
              id="confirm-type"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className={settingsFieldClass}
            />
          </div>
        ) : null}
      </ConfirmSheet>
    </div>
  );
}

/** Members couldn&apos;t load. say so plainly, offer a retry, keep the rest of Settings usable. */
export function MembersLoadError() {
  return (
    <SettingsGroup title="Members">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-body text-ink-2" role="alert">Members couldn&apos;t load.</p>
        <a href="" className="text-body font-medium text-accent hover:underline">Try again</a>
      </div>
    </SettingsGroup>
  );
}
