"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import {
  formatBulletinEndLabel,
  liveBulletinItems,
  type BulletinExpiry,
  type BulletinItem,
} from "@/lib/dailyBulletin";
import {
  clearBulletinAction,
  postBulletinAction,
  type BulletinActionState,
} from "@/app/(desk)/settings/bulletinActions";
import {
  SettingsGroup,
  SettingsSegmented,
  settingsFieldClass,
  settingsGhostButtonClass,
  settingsPrimaryButtonClass,
} from "@/components/settingsUi";

const EXPIRY_OPTIONS: { id: BulletinExpiry; label: string }[] = [
  { id: "today", label: "Until tonight" },
  { id: "tomorrow", label: "Until tomorrow night" },
  { id: "manual", label: "Until I clear it" },
];

const initial: BulletinActionState = {};

export function DailyBulletinPanel({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [expiry, setExpiry] = useState<BulletinExpiry>("today");
  const [items, setItems] = useState<BulletinItem[]>(() =>
    liveBulletinItems(tenant.daily_bulletin)
  );
  const [postState, postAction, postPending] = useActionState(
    postBulletinAction,
    initial
  );
  const [clearState, clearAction, clearPending] = useActionState(
    clearBulletinAction,
    initial
  );

  useEffect(() => {
    setItems(liveBulletinItems(tenant.daily_bulletin));
  }, [tenant.daily_bulletin]);

  useEffect(() => {
    if (postState.ok) {
      setText("");
      router.refresh();
    }
  }, [postState, router]);

  useEffect(() => {
    if (clearState.ok) router.refresh();
  }, [clearState, router]);

  const flash = postState.error || clearState.error
    ? postState.error || clearState.error
    : postState.message || clearState.message;
  const flashIsError = Boolean(postState.error || clearState.error);

  return (
    <section className="min-w-0 w-full space-y-6">
      <form action={postAction} className="min-w-0 space-y-3">
        <input type="hidden" name="tenant_id" value={tenant.id} />
        <input type="hidden" name="expiry" value={expiry} />
        <SettingsGroup title="Callers hear">
          <div className="flex min-w-0 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="bulletin_text">
                Callers hear
              </label>
              <input
                id="bulletin_text"
                name="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={160}
                placeholder="Out of chicken today"
                className={`${settingsFieldClass} mt-0 min-w-0`}
              />
            </div>
            <button
              type="submit"
              disabled={postPending || !text.trim()}
              className={settingsPrimaryButtonClass}
            >
              {postPending ? "Posting…" : "Post update"}
            </button>
          </div>
        </SettingsGroup>

        <SettingsSegmented
          label="Update duration"
          value={expiry}
          options={EXPIRY_OPTIONS}
          onChange={setExpiry}
        />
      </form>

      {items.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">
          No live updates.
        </p>
      ) : (
        <SettingsGroup title="Live">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1 basis-[12rem]">
                <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                  {item.text}
                </p>
                <p className="mt-1 text-xs text-ink-soft">
                  {formatBulletinEndLabel(item.ends_at)}
                </p>
              </div>
              <form action={clearAction} className="shrink-0">
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <input type="hidden" name="bulletin_id" value={item.id} />
                <button
                  type="submit"
                  disabled={clearPending}
                  className={settingsGhostButtonClass}
                >
                  Clear
                </button>
              </form>
            </div>
          ))}
        </SettingsGroup>
      )}

      {flash ? (
        <p
          className={`text-sm [overflow-wrap:anywhere] ${flashIsError ? "text-warn" : "text-ok"}`}
          role={flashIsError ? "alert" : undefined}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}
