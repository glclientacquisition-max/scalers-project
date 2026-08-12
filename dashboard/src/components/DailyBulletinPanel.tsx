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
import { settingsChipClass, settingsFieldClass } from "@/components/settingsUi";

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
    <section className="space-y-4">
      <h2 className="font-display text-2xl tracking-tight text-[var(--ink)]">
        Updates
      </h2>

      <form action={postAction} className="space-y-3">
        <input type="hidden" name="tenant_id" value={tenant.id} />
        <input type="hidden" name="expiry" value={expiry} />
        <label className="block text-sm font-medium" htmlFor="bulletin_text">
          What should callers know
        </label>
        <input
          id="bulletin_text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={160}
          placeholder="Out of chicken today"
          className={settingsFieldClass}
        />

        <div className="flex flex-wrap gap-2">
          {EXPIRY_OPTIONS.map((opt) => {
            const selected = expiry === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setExpiry(opt.id)}
                className={settingsChipClass(selected)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <button
          type="submit"
          disabled={postPending || !text.trim()}
          className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--accent-deep)] disabled:opacity-50"
        >
          {postPending ? "Posting…" : "Post update"}
        </button>
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">
          No live updates. The assistant will use your normal services and FAQs.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-white px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--accent)]">
                  Live now
                </p>
                <p className="mt-1 text-sm font-medium text-[var(--ink)]">{item.text}</p>
                <p className="mt-1 text-xs text-[var(--ink-soft)]">
                  {formatBulletinEndLabel(item.ends_at)}
                </p>
              </div>
              <form action={clearAction}>
                <input type="hidden" name="tenant_id" value={tenant.id} />
                <input type="hidden" name="bulletin_id" value={item.id} />
                <button
                  type="submit"
                  disabled={clearPending}
                  className="text-sm text-[var(--ink-soft)] hover:text-[var(--warn)] disabled:opacity-50"
                >
                  Clear
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {flash ? (
        <p
          className={`text-sm ${flashIsError ? "text-[var(--warn)]" : "text-[var(--ok)]"}`}
          role={flashIsError ? "alert" : undefined}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}
