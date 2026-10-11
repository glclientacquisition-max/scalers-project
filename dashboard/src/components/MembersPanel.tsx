"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { notify } from "@/components/ui/DeskNotice";
import { transferConfirmMatches } from "@/lib/memberConfirm";
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
import {
  settingsActionClass,
  settingsBlockTitleClass,
  settingsFieldClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

/**
 * Settings > Team & access > Members (logins, paid seats). No <form> elements:
 * this renders inside the Settings <form>, so actions are called directly.
 */
export function MembersPanel({ data, viewerRole, viewerId }: { data: MembersData; viewerRole: Role; viewerId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("staff");
  const [flash, setFlash] = useState<MembersActionResult | null>(null);
  const [pending, start] = useTransition();
  const roles = assignableRoles(viewerRole);
  const canInvite = roles.length > 0;
  const { seats } = data;

  const router = useRouter();
  type Pending = { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; typeToConfirm?: string; fn: () => Promise<MembersActionResult>; refreshAll?: boolean };
  const [confirming, setConfirming] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");

  /** Runs an action and ALWAYS surfaces the outcome: inline + desk toast (survives a re-render/remount). */
  function run(fn: () => Promise<MembersActionResult>, opts?: { refreshAll?: boolean; onDone?: () => void }) {
    start(async () => {
      let result: MembersActionResult;
      try {
        result = await fn();
      } catch {
        result = { error: "Something went wrong. Nothing was changed. Try again." };
      }
      if (!result.ok && !result.error) result = { ...result, error: "Something went wrong. Try again." };
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

  return (
    <section className="space-y-3" aria-labelledby="members-title">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <p id="members-title" className={settingsBlockTitleClass}>
          Members
          <span className="ml-2 font-medium normal-case tracking-normal text-ink-soft">
            Seats {seats.used} of {seats.included}
            {seats.pending ? ` (incl. ${seats.pending} invited)` : ""}
          </span>
        </p>
      </div>
      <p className="px-1 text-sm text-ink-soft">
        Members sign in with their own account and use a paid seat. Alert contacts below only get notified.
      </p>

      <ul className="divide-y divide-line rounded-panel border border-line">
        {data.members.map((m) => {
          const self = m.userId === viewerId;
          const manageable = !self && canManageMember(viewerRole, m.role);
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink" title={m.email}>
                  {m.name || m.email}
                  {self ? <span className="ml-2 text-xs text-ink-soft">(you)</span> : null}
                </p>
                {m.name ? <p className="truncate text-xs text-ink-soft">{m.email}</p> : null}
              </div>
              {manageable ? (
                <select
                  aria-label={`Role for ${m.email}`}
                  value={m.role}
                  disabled={pending}
                  onChange={(e) => run(() => changeMemberRoleAction(m.userId, e.target.value))}
                  className={`${settingsFieldClass} mt-0 w-36`}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-ink-soft">{ROLE_LABELS[m.role]}</span>
              )}
              {viewerRole === "owner" && m.role === "admin" ? (
                <button
                  type="button"
                  className={settingsActionClass}
                  disabled={pending}
                  onClick={() =>
                    ask({
                      title: `Make ${m.name || m.email} the owner?`,
                      confirmLabel: "Transfer ownership",
                      danger: true,
                      typeToConfirm: m.email,
                      refreshAll: true,
                      fn: () => transferOwnershipAction(m.userId),
                      body: (
                        <div className="space-y-2" data-transfer-consequences="">
                          <p>
                            <strong className="text-ink">{m.email}</strong> becomes the owner of this business. This takes effect straight away.
                          </p>
                          <ul className="list-disc space-y-1 pl-5">
                            <li>You become an <strong className="text-ink">Admin</strong>. You keep access to the inbox, settings, usage and top-ups.</li>
                            <li>You can no longer transfer ownership. Only the new owner can, including giving it back to you.</li>
                            <li>The new owner holds the account and its billing. They can change your role or remove you.</li>
                          </ul>
                        </div>
                      ),
                    })
                  }
                >
                  Make owner
                </button>
              ) : null}
              {manageable ? (
                <button
                  type="button"
                  className={settingsActionClass}
                  disabled={pending}
                  onClick={() =>
                    ask({
                      title: `Remove ${m.name || m.email}?`,
                      confirmLabel: "Remove",
                      danger: true,
                      fn: () => removeMemberAction(m.userId),
                      body: <p>They lose access right away and their seat is freed. You can invite them again later.</p>,
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </li>
          );
        })}
        {data.invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{i.email}</p>
              <p className="text-xs text-ink-soft">
                Invited as {ROLE_LABELS[i.role]} · expires in {daysLeft(i.expiresAt)} day{daysLeft(i.expiresAt) === 1 ? "" : "s"}
              </p>
            </div>
            {canInvite && canManageMember(viewerRole, i.role) ? (
              <>
                <button type="button" className={settingsActionClass} disabled={pending} onClick={() => run(() => resendInviteAction(i.id))}>
                  Resend
                </button>
                <button
                  type="button"
                  className={settingsActionClass}
                  disabled={pending}
                  onClick={() =>
                    ask({
                      title: `Cancel the invite to ${i.email}?`,
                      confirmLabel: "Cancel invite",
                      fn: () => revokeInviteAction(i.id),
                      body: <p>The link in their email stops working and the seat is freed.</p>,
                    })
                  }
                >
                  Revoke
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>

      {canInvite ? (
        seats.full ? (
          <div className="rounded-panel border border-line px-3 py-3 text-sm">
            <p className="text-ink">All {seats.included} seats are in use.</p>
            <Link href="/wallet" className="mt-1 inline-block font-medium text-accent-deep hover:underline">
              Upgrade your package to invite more people
            </Link>
          </div>
        ) : (
          <div className="space-y-2 rounded-panel border border-line px-3 py-3">
            <label className="block text-sm font-medium text-ink" htmlFor="invite-email">Invite by email</label>
            <input
              id="invite-email"
              type="text"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@business.co.ke"
              className={settingsFieldClass}
            />
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-ink">Role</legend>
              {roles.map((r) => (
                <label key={r} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="invite-role" checked={role === r} onChange={() => setRole(r)} className="mt-1" />
                  <span>
                    <span className="font-medium text-ink">{ROLE_LABELS[r]}</span>
                    <span className="block text-ink-soft">{ROLE_BLURBS[r]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              type="button"
              className={settingsPrimaryButtonClass}
              disabled={pending || !email.trim()}
              onClick={() => run(() => inviteMemberAction(email, role))}
            >
              {pending ? "Sending…" : "Send invite"}
            </button>
          </div>
        )
      ) : null}

      {flash ? (
        <p role={flash.error ? "alert" : "status"} className={`text-sm ${flash.error ? "text-warn" : "text-accent-deep"}`}>
          {flash.error || flash.message}
        </p>
      ) : null}

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
            <label htmlFor="confirm-type" className="block text-sm font-medium text-ink">
              Type <span className="font-mono">{confirming.typeToConfirm}</span> to confirm
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

      <p className={`${settingsBlockTitleClass} px-1 pt-4`}>Alert contacts</p>
    </section>
  );
}
