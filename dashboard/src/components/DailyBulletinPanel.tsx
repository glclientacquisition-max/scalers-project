"use client";

import { withRoleGate } from "@/components/DeskRole";
import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantRow } from "@/lib/supabase";
import { CALLERS_HEAR_POOLS, placeholderPool } from "@/lib/deskPlaceholders";
import { useMountedPoolPick } from "@/lib/useMountedPoolPick";
import { parseVertical } from "@/lib/vertical";
import {
  deskBulletinItems,
  eatDateLocal,
  eatTimeLocal,
  endOfEatDay,
  formatBulletinComposePreview,
  formatBulletinWindowLabel,
  joinEatDateTime,
  type BulletinAnnounce,
  type BulletinExpiry,
  type BulletinItem,
} from "@/lib/dailyBulletin";
import {
  clearBulletinAction,
  editBulletinAction,
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
  { id: "schedule", label: "Pick" },
];

const ANNOUNCE_OPTIONS: { id: BulletinAnnounce; label: string }[] = [
  { id: "always", label: "Tell every caller" },
  { id: "ask", label: "Only if they ask" },
];

const START_OPTIONS = [
  { id: "now", label: "Now" },
  { id: "later", label: "Later" },
] as const;

const initial: BulletinActionState = {};

function tonightParts() {
  const end = new Date(endOfEatDay());
  return { date: eatDateLocal(end), time: eatTimeLocal(end) };
}

function DailyBulletinPanelInner({ tenant }: { tenant: TenantRow }) {
  const router = useRouter();
  const callersHearExample = useMountedPoolPick(
    placeholderPool(CALLERS_HEAR_POOLS, parseVertical(tenant.vertical))
  );
  const tonight = tonightParts();
  const [text, setText] = useState("");
  const [announce, setAnnounce] = useState<BulletinAnnounce>("ask");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<"post" | "edit" | "clear" | null>(null);
  const [expiry, setExpiry] = useState<BulletinExpiry>("today");
  const [startWhen, setStartWhen] = useState<(typeof START_OPTIONS)[number]["id"]>(
    "now"
  );
  const [startDate, setStartDate] = useState(eatDateLocal);
  const [startTime, setStartTime] = useState(eatTimeLocal);
  const [endDate, setEndDate] = useState(tonight.date);
  const [endTime, setEndTime] = useState(tonight.time);
  const [items, setItems] = useState<BulletinItem[]>(() =>
    deskBulletinItems(tenant.daily_bulletin)
  );
  const [postState, postAction, postPending] = useActionState(
    postBulletinAction,
    initial
  );
  const [clearState, clearAction, clearPending] = useActionState(
    clearBulletinAction,
    initial
  );
  const [editState, editAction, editPending] = useActionState(
    editBulletinAction,
    initial
  );

  const startsLocal =
    expiry === "schedule" && startWhen === "later"
      ? joinEatDateTime(startDate, startTime)
      : "";
  const endsLocal =
    expiry === "schedule" ? joinEatDateTime(endDate, endTime) : "";

  const preview = useMemo(
    () =>
      formatBulletinComposePreview({
        expiry,
        startsLocal,
        endsLocal,
      }),
    [expiry, startsLocal, endsLocal]
  );

  useEffect(() => {
    setItems(deskBulletinItems(tenant.daily_bulletin));
  }, [tenant.daily_bulletin]);

  useEffect(() => {
    if (!postState.at) return;
    setLastAction("post");
    if (postState.ok) {
      setText("");
      router.refresh();
    }
  }, [postState, router]);

  useEffect(() => {
    if (!editState.at) return;
    setLastAction("edit");
    if (editState.ok) {
      setText("");
      setEditingId(null);
      router.refresh();
    }
  }, [editState, router]);

  useEffect(() => {
    if (!clearState.at) return;
    setLastAction("clear");
    if (clearState.ok) router.refresh();
  }, [clearState, router]);

  // Only the latest action speaks, so a clear never shows the earlier post's message.
  const latest = lastAction === "post" ? postState : lastAction === "edit" ? editState : lastAction === "clear" ? clearState : initial;
  const flash = latest.error || latest.message;
  const flashIsError = Boolean(latest.error);
  const composePending = postPending || editPending;

  const startEdit = (item: BulletinItem) => {
    setEditingId(item.id);
    setText(item.text);
    setAnnounce(item.announce ?? "ask");
    if (item.ends_at) {
      const end = new Date(item.ends_at);
      setExpiry("schedule");
      setStartWhen("now");
      setEndDate(eatDateLocal(end));
      setEndTime(eatTimeLocal(end));
    } else {
      setExpiry("manual");
    }
    if (typeof window !== "undefined") document.getElementById("bulletin_text")?.focus();
  };
  const cancelEdit = () => {
    setEditingId(null);
    setText("");
  };

  return (
    <section className="min-w-0 w-full space-y-3">
      <form action={editingId ? editAction : postAction} data-pull-dirty-guard="" className="min-w-0 space-y-3">
        <input type="hidden" name="tenant_id" value={tenant.id} />
        <input type="hidden" name="announce" value={announce} />
        {editingId ? <input type="hidden" name="bulletin_id" value={editingId} /> : null}
        <input type="hidden" name="expiry" value={expiry} />
        <input type="hidden" name="starts_at" value={startsLocal} />
        <input type="hidden" name="ends_at" value={endsLocal} />
        <SettingsGroup title={editingId ? "Edit update" : "Callers hear"}>
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
                placeholder={`e.g. ${callersHearExample}`}
                className={`${settingsFieldClass} mt-0 min-w-0`}
              />
            </div>
            <div className="flex shrink-0 gap-2">
              {editingId ? (
                <button type="button" onClick={cancelEdit} className={settingsGhostButtonClass}>
                  Cancel
                </button>
              ) : null}
              <button
                type="submit"
                disabled={composePending || !text.trim()}
                className={settingsPrimaryButtonClass}
              >
                {editingId ? (editPending ? "Saving…" : "Save update") : postPending ? "Posting…" : "Post update"}
              </button>
            </div>
          </div>
        </SettingsGroup>

        <p className="px-1 text-meta font-medium text-ink-2">Who hears it</p>
        <SettingsSegmented
          label="Who hears it"
          value={announce}
          options={ANNOUNCE_OPTIONS}
          onChange={setAnnounce}
        />

        <p className="px-1 text-meta font-medium text-ink-2">How long</p>
        <SettingsSegmented
          label="How long"
          value={expiry}
          options={EXPIRY_OPTIONS}
          onChange={setExpiry}
        />

        {expiry === "schedule" ? (
          <div className="min-w-0 space-y-3">
            <div className="min-w-0 space-y-2">
              <p className="text-meta font-medium text-ink-2">
                From
              </p>
              <SettingsSegmented
                label="From"
                value={startWhen}
                options={START_OPTIONS}
                onChange={setStartWhen}
              />
              {startWhen === "later" ? (
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <label className="min-w-0">
                    <span className="sr-only">Start date</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className={`${settingsFieldClass} mt-0 min-w-0`}
                    />
                  </label>
                  <label className="min-w-0">
                    <span className="sr-only">Start time</span>
                    <input
                      type="time"
                      value={startTime}
                      onChange={(e) => setStartTime(e.target.value)}
                      className={`${settingsFieldClass} mt-0 min-w-0`}
                    />
                  </label>
                </div>
              ) : null}
            </div>
            <div className="min-w-0 space-y-2">
              <p className="text-meta font-medium text-ink-2">
                Until
              </p>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                <label className="min-w-0">
                  <span className="sr-only">End date</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={`${settingsFieldClass} mt-0 min-w-0`}
                  />
                </label>
                <label className="min-w-0">
                  <span className="sr-only">End time</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={`${settingsFieldClass} mt-0 min-w-0`}
                  />
                </label>
              </div>
            </div>
          </div>
        ) : null}

        <p className="px-1 text-body text-ink-2">{preview}</p>
      </form>

      {items.length === 0 ? (
        <p className="px-1 text-body text-ink-2">
          No live updates.
        </p>
      ) : (
        <SettingsGroup title="Posted">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1 basis-[12rem]">
                <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">
                  {item.text}
                </p>
                <p className="mt-1 text-meta text-ink-2">
                  {formatBulletinWindowLabel(item)}
                  {" · "}
                  {item.announce === "always" ? "Every caller" : "If they ask"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => startEdit(item)}
                disabled={composePending || clearPending}
                className={settingsGhostButtonClass}
              >
                Edit
              </button>
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
          className={`text-body [overflow-wrap:anywhere] ${flashIsError ? "text-warn" : "text-ok"}`}
          role={flashIsError ? "alert" : undefined}
        >
          {flash}
        </p>
      ) : null}
    </section>
  );
}

export const DailyBulletinPanel = withRoleGate("settings.edit", DailyBulletinPanelInner);
