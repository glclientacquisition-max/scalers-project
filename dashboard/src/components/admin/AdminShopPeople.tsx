"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminShopPeople } from "@/lib/adminShopPeople";
import { ConfirmSheet } from "@/components/ui/ConfirmSheet";
import { Empty } from "@/components/ui/Empty";
import { ListRow } from "@/components/ui/ListRow";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";

function roleLabel(role: string) {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  if (role === "staff") return "Staff";
  if (role === "viewer") return "Viewer";
  return role;
}

export function AdminShopPeople({
  businessId,
  people,
}: {
  businessId: string;
  people: AdminShopPeople;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const owner = people.members.find((member) => member.role === "owner");
  const transferCandidates = people.members.filter((member) => member.role === "admin");

  async function post(action: string, extra: Record<string, unknown> = {}) {
    setError("");
    setStatus("");
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, business_id: businessId, ...extra }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return false;
    }
    setResetOpen(false);
    setTransferOpen(false);
    setStatus(action === "send_owner_reset" ? `Reset email sent to ${json.email || owner?.email || "the owner"}.` : "Saved.");
    startTransition(() => router.refresh());
    return true;
  }

  return (
    <section aria-labelledby="shop-people">
      <h2 id="shop-people" className="px-4 pb-2 text-caption text-ink-3">
        People
      </h2>
      {error ? (
        <p className="px-4 pb-2 text-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="px-4 pb-2 text-body text-ok" role="status">
          {status}
        </p>
      ) : null}
      {people.members.length === 0 ? (
        <Empty className="px-4" title="No members yet." line="The owner shows up after signup." />
      ) : (
        <ul className="divide-y divide-hairline">
          {people.members.map((member) => (
            <ListRow
              key={member.userId}
              title={member.name || member.email || "Member"}
              preview={member.email || roleLabel(member.role)}
              stamp={<Stamp tone={member.role === "owner" ? "ok" : "neutral"}>{roleLabel(member.role)}</Stamp>}
            />
          ))}
        </ul>
      )}
      {people.invites.length > 0 ? (
        <>
          <p className="px-4 pt-3 text-caption text-ink-3">Pending invites</p>
          <ul className="divide-y divide-hairline">
            {people.invites.map((invite) => (
              <ListRow
                key={invite.id}
                title={invite.email}
                preview={roleLabel(invite.role)}
                stamp={<Stamp tone="attention">Pending</Stamp>}
              />
            ))}
          </ul>
        </>
      ) : null}
      <ul className="divide-y divide-hairline border-t border-hairline">
        <ListRow
          title="Send owner password reset"
          preview={owner?.email || "No owner email"}
          onOpen={owner?.email ? () => setResetOpen(true) : undefined}
        />
        <ListRow
          title="Transfer ownership"
          preview={
            transferCandidates.length > 0
              ? "Make an Admin the owner"
              : "Add an Admin first"
          }
          onOpen={transferCandidates.length > 0 ? () => setTransferOpen(true) : undefined}
        />
      </ul>

      <ConfirmSheet
        open={resetOpen}
        theme="admin"
        title="Send password reset?"
        confirmLabel="Send email"
        pending={pending}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void post("send_owner_reset")}
      >
        <p className="text-body text-ink-2">
          {owner?.email
            ? `A reset link goes to ${owner.email}. They choose a new password on the owner desk.`
            : "No owner email on file."}
        </p>
      </ConfirmSheet>

      <Sheet
        open={transferOpen}
        onOpenChange={(next) => {
          if (!next) setTransferOpen(false);
        }}
        title="Transfer ownership"
        theme="admin"
      >
        <p className="pb-3 text-body text-ink-2">Pick the Admin who should own this business.</p>
        <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
          {transferCandidates.map((member) => (
            <ListRow
              key={member.userId}
              title={member.name || member.email}
              preview={member.email}
              onOpen={() => void post("transfer_owner", { user_id: member.userId })}
            />
          ))}
        </ul>
        {transferCandidates.length === 0 ? (
          <Empty className="px-0 py-6" title="No Admin yet." line="Invite an Admin on the owner desk first." />
        ) : null}
      </Sheet>
    </section>
  );
}
