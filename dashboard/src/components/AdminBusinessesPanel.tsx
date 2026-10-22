"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AdminBusiness } from "@/lib/admin";
import type { QualityBadge } from "@/lib/adminQualityModel";
import { formatScore } from "@/lib/adminQualityModel";
import { previewLine, statusLabel, statusTone } from "@/lib/adminBusinessUi";
import type { PendingTenant } from "@/lib/didPool";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Empty";
import { Input } from "@/components/ui/Field";
import { ListRow } from "@/components/ui/ListRow";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Stamp } from "@/components/ui/Stamp";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Pagination, DEFAULT_PAGE_SIZE } from "@/components/ui/Pagination";

type ShopFilter = "all" | "waiting" | "active" | "suspended" | "archived";

export function AdminBusinessesPanel({
  businesses,
  pendingBusinesses,
  availableDids,
  badges = {},
}: {
  businesses: AdminBusiness[];
  pendingBusinesses: PendingTenant[];
  availableDids: { e164: string }[];
  badges?: Record<string, QualityBadge>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ShopFilter>("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [assignId, setAssignId] = useState<string | null>(null);

  const PAGE_SIZE = DEFAULT_PAGE_SIZE;
  const freeCount = availableDids.length;
  const assignBusiness = assignId ? businesses.find((b) => b.id === assignId) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter((b) => {
      if (filter === "all" ? b.status === "archived" : b.status !== filter) return false;
      if (!q) return true;
      return (
        b.business_name.toLowerCase().includes(q) ||
        b.sautikit_virtual_number.toLowerCase().includes(q) ||
        b.whatsapp_notification_number.toLowerCase().includes(q) ||
        (b.package_name || "").toLowerCase().includes(q)
      );
    });
  }, [businesses, filter, query]);

  const waiting = businesses.filter((b) => b.status === "waiting");
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function assignNext(businessId: string) {
    setError("");
    const res = await fetch("/api/admin/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_next", business_id: businessId }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return;
    }
    setAssignId(null);
    startTransition(() => router.refresh());
  }

  async function assignSpecific(businessId: string, e164: string) {
    setError("");
    const res = await fetch("/api/did-pool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_specific", tenant_id: businessId, e164 }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(json.error || "Could not save.");
      return;
    }
    setAssignId(null);
    startTransition(() => router.refresh());
  }

  const emptyTitle = businesses.length === 0 ? "No businesses." : "No match.";
  const emptyLine =
    businesses.length === 0 ? "A business shows up here after signup." : "Try another name or number.";

  return (
    <>
      <AdminPageHeader title="Businesses" />

      {pendingBusinesses.length > 0 ? (
        <section>
          <p className="px-4 text-caption text-ink-3">Needs you</p>
          {freeCount === 0 ? (
            <div className="px-4 py-3">
              <Empty
                className="px-0 py-8"
                title="No numbers available"
                line={pendingBusinesses.length === 1 ? "1 waiting" : `${pendingBusinesses.length} waiting`}
                action={<ButtonLink href="/admin/numbers">Add number</ButtonLink>}
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {pendingBusinesses.map((row) => {
                const b = businesses.find((biz) => biz.id === row.id);
                const name = b?.business_name || row.business_name;
                return (
                  <ListRow
                    key={row.id}
                    href={`/admin/businesses/${row.id}`}
                    title={name}
                    preview="Waiting"
                    unread
                    actions={
                      freeCount > 0 ? (
                        <Button type="button" variant="tonal" size="sm" onClick={() => setAssignId(row.id)}>
                          Assign
                        </Button>
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <section>
        <p className="px-4 text-caption text-ink-3">All</p>
        <div className="px-4 py-2">
          <Input
            id="biz-search"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search"
            aria-label="Search businesses"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Segmented
          label="Businesses filter"
          items={[
            {
              key: "all",
              label: "All",
              count: businesses.filter((b) => b.status !== "archived").length,
              active: filter === "all",
            },
            { key: "waiting", label: "Waiting", count: waiting.length, active: filter === "waiting" },
            {
              key: "active",
              label: "Active",
              count: businesses.filter((b) => b.status === "active").length,
              active: filter === "active",
            },
            {
              key: "suspended",
              label: "Suspended",
              count: businesses.filter((b) => b.status === "suspended").length,
              active: filter === "suspended",
            },
            {
              key: "archived",
              label: "Archived",
              count: businesses.filter((b) => b.status === "archived").length,
              active: filter === "archived",
            },
          ]}
          onSelect={(key) => {
            setFilter(key as ShopFilter);
            setPage(1);
          }}
        />
        {error ? (
          <p className="px-4 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {pageRows.length === 0 ? (
          <Empty title={emptyTitle} line={emptyLine} />
        ) : (
          <ul className="divide-y divide-hairline">
            {pageRows.map((b) => {
              const badge = badges[b.id];
              return (
                <ListRow
                  key={b.id}
                  href={`/admin/businesses/${b.id}`}
                  title={b.business_name}
                  preview={badge?.dropping ? `${previewLine(b)} · ${badge.droppingReason}` : previewLine(b)}
                  when={badge && badge.score != null ? formatScore(badge.score) : undefined}
                  stamp={
                    <span className="inline-flex items-center gap-2">
                      {badge?.dropping ? <Stamp tone="attention">Dropping</Stamp> : null}
                      <Stamp tone={statusTone(b.status)}>{statusLabel(b.status)}</Stamp>
                    </span>
                  }
                />
              );
            })}
          </ul>
        )}
        <Pagination
          page={safePage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          noun="shop"
          onPage={setPage}
          className="px-4 py-3"
        />
      </section>

      <Sheet
        open={Boolean(assignId && assignBusiness)}
        onOpenChange={(next) => {
          if (!next) setAssignId(null);
        }}
        title={assignBusiness?.business_name || "Assign"}
        theme="admin"
        footer={
          assignBusiness && freeCount > 0 ? (
            <Button
              type="button"
              block
              pending={pending}
              onClick={() => assignBusiness && void assignNext(assignBusiness.id)}
            >
              Assign next
            </Button>
          ) : (
            <ButtonLink href="/admin/numbers" block>
              Add number
            </ButtonLink>
          )
        }
      >
        {error ? (
          <p className="pb-3 text-body text-attention" role="alert">
            {error}
          </p>
        ) : null}
        {freeCount === 0 ? (
          <Empty className="px-0 py-8" title="No numbers available" line="Add a number, then assign." />
        ) : (
          <ul className="-mx-5 divide-y divide-hairline sm:-mx-6">
            {availableDids.map((row) => (
              <ListRow
                key={row.e164}
                title={row.e164}
                onOpen={() =>
                  assignBusiness && void assignSpecific(assignBusiness.id, row.e164)
                }
              />
            ))}
          </ul>
        )}
      </Sheet>
    </>
  );
}
