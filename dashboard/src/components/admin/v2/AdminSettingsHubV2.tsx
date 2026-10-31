"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { holdSettings, type SettingsHubRaw } from "@/lib/ops/settingsHubView";
import { clampHoldDays, reactivationFeeSurface } from "@/lib/ops/numberHold";
import { Button } from "@/components/ui/Button";
import { PageHeader, OpsConfirm, useAdminUnlockSession } from "@/components/ops";
import "@/styles/ops.css";

const WHEN = new Intl.DateTimeFormat("en-KE", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Africa/Nairobi",
});

/**
 * Settings hub (ADMIN_V2): Number hold card.
 * View-only until Unlock (observe) reveals the edit form. Writes go through
 * /api/admin/number-hold with a reason — never silent, never fake success.
 */
export function AdminSettingsHubV2({ raw }: { raw: SettingsHubRaw | null }) {
  const router = useRouter();
  const rows = holdSettings(raw);
  const here = rows.every((r) => r.state !== "absent");
  const feeSurface = reactivationFeeSurface(raw?.reactivation_fee_kes ?? null);

  const unlockSession = useAdminUnlockSession();
  const unlocked = unlockSession.status?.mode !== "enforce" || unlockSession.unlocked;
  const [editHold, setEditHold] = useState(false);
  const [enabled, setEnabled] = useState(raw?.hold_winback_enabled !== false);
  const [days, setDays] = useState(clampHoldDays(raw?.number_hold_days, 14));
  const [feeText, setFeeText] = useState(
    raw?.reactivation_fee_kes == null ? "" : String(raw.reactivation_fee_kes),
  );
  const [clearFee, setClearFee] = useState(raw?.reactivation_fee_kes == null);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    setEnabled(raw?.hold_winback_enabled !== false);
    setDays(clampHoldDays(raw?.number_hold_days, 14));
    setFeeText(raw?.reactivation_fee_kes == null ? "" : String(raw.reactivation_fee_kes));
    setClearFee(raw?.reactivation_fee_kes == null);
  }, [raw?.hold_winback_enabled, raw?.number_hold_days, raw?.reactivation_fee_kes, raw?.updated_at]);

  useEffect(() => {
    if (unlocked && here) setEditHold(true);
    if (!unlocked) setEditHold(false);
  }, [unlocked, here]);

  async function save(reason: string) {
    setPending(true);
    setError("");
    setStatus("");
    const feeKes = clearFee || feeText.trim() === "" ? null : Number(feeText);
    if (!clearFee && feeKes != null && (!Number.isFinite(feeKes) || feeKes <= 0)) {
      setPending(false);
      setError("Reactivation fee must be above zero, or cleared for none.");
      return;
    }
    try {
      const res = await fetch("/api/admin/number-hold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "set_settings",
          enabled,
          days: clampHoldDays(days, 14),
          fee_kes: clearFee ? null : feeKes,
          clear_fee: clearFee,
          reason,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error || "Could not save hold settings.");
        setPending(false);
        return;
      }
      setConfirm(false);
      setStatus("Hold settings saved.");
      setPending(false);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not save hold settings.");
      setPending(false);
    }
  }

  return (
    <div className="ops-theme flex w-full flex-col gap-ops-3 pe-ops-4 text-ops-body">
      <PageHeader title="General" />
      {status ? (
        <p className="text-ops-body text-ok" role="status" data-hold-settings-status="">
          {status}
        </p>
      ) : null}
      {error && !confirm ? (
        <p className="text-ops-body text-attention" role="alert">
          {error}
        </p>
      ) : null}
      <article className="overflow-hidden rounded-sm border border-hairline bg-surface" data-number-hold="" data-stepup="settings">
        <header className="flex flex-wrap items-start justify-between gap-x-ops-4 gap-y-1 border-b border-hairline px-ops-3 py-ops-2">
          <div className="min-w-0">
            <h2 className="font-semibold text-ink">Number hold</h2>
            <p className="mt-0.5 text-ops-label text-ink-2">
              {here
                ? "What happens to a business's number when the line stops."
                : "Hold settings are not on this environment. Values below are not invented."}
            </p>
          </div>
          <p className="shrink-0 text-ops-label text-ink-2">
            {unlocked && editHold && here ? "Editing · confirm to save" : "View only · unlock in header"}
            {raw?.updated_at ? <span className="ms-1 block tabular-nums md:inline">· {WHEN.format(new Date(raw.updated_at))}</span> : null}
          </p>
        </header>

        {unlocked && editHold && here ? (
          <div className="flex flex-col gap-ops-3 px-ops-3 py-ops-3" data-hold-edit="">
            <label className="flex min-h-ops-touch items-start gap-3">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                data-field="hold-enabled"
                className="mt-1"
              />
              <span>
                <span className="font-semibold text-ink">Hold after release</span>
                <span className="mt-0.5 block text-ops-label text-ink-2">
                  On: operators can hold a number for win-back. Off: released numbers go to the pool after the normal wait; running holds still finish.
                </span>
              </span>
            </label>
            <label className="flex max-w-[12rem] flex-col gap-1">
              <span className="text-ops-label font-semibold text-ink">Default hold length (days)</span>
              <input
                type="number"
                min={1}
                max={90}
                value={days}
                onChange={(e) => setDays(clampHoldDays(Number(e.target.value), 14))}
                data-field="hold-days"
                className="ops-field tabular-nums text-ink"
              />
            </label>
            <div className="flex flex-col gap-2">
              <span className="text-ops-label font-semibold text-ink">Reactivation fee (KSh)</span>
              <label className="flex min-h-ops-touch items-center gap-2 text-ink">
                <input
                  type="checkbox"
                  checked={clearFee}
                  onChange={(e) => {
                    setClearFee(e.target.checked);
                    if (e.target.checked) setFeeText("");
                  }}
                  data-field="clear-fee"
                />
                <span>No fee</span>
              </label>
              {!clearFee ? (
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={feeText}
                  onChange={(e) => setFeeText(e.target.value)}
                  placeholder="e.g. 1500"
                  data-field="reactivation-fee"
                  className="ops-field max-w-[12rem] tabular-nums text-ink"
                />
              ) : null}
              <p className="text-ops-label text-ink-2" data-reactivation-fee-note="">
                {feeSurface.note}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-hairline pt-ops-3">
              <Button type="button" variant="primary" size="sm" data-action="save-hold-settings" onClick={() => { setError(""); setConfirm(true); }}>
                Save hold settings
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditHold(false);
                  setEnabled(raw?.hold_winback_enabled !== false);
                  setDays(clampHoldDays(raw?.number_hold_days, 14));
                  setFeeText(raw?.reactivation_fee_kes == null ? "" : String(raw.reactivation_fee_kes));
                  setClearFee(raw?.reactivation_fee_kes == null);
                }}
              >
                Cancel edit
              </Button>
            </div>
          </div>
        ) : (
          <dl>
            {rows.map((v) => (
              <div key={v.label} className="grid grid-cols-1 gap-1 border-b border-hairline px-ops-3 py-ops-3 last:border-b-0 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-ops-4">
                <dt className="text-ink-2">{v.label}</dt>
                <dd className="min-w-0">
                  <div className="font-semibold tabular-nums text-ink">{v.value}</div>
                  <p className="mt-0.5 text-ops-label text-ink-2">{v.note}</p>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!unlocked || !editHold ? (
          <p className="border-t border-hairline px-ops-3 py-ops-3 text-ops-label text-ink-2">
            {here
              ? unlocked
                ? "Edit form hidden. Unlock stays live in the header."
                : "Unlock in the header to edit. Saving asks for a reason."
              : "Hold columns are not on this environment. Nothing to edit here."}
          </p>
        ) : null}
      </article>
      <section aria-label="Other settings" className="flex flex-col">
        <h2 className="px-ops-3 pb-ops-1 text-ops-label font-semibold uppercase tracking-wide text-ink-2">Also in Settings</h2>
        <ul className="divide-y divide-hairline border border-hairline bg-surface">
          {[
            ["/admin/settings/services", "Services", "Service list businesses pick from."],
            ["/admin/settings/voices", "Voices", "Assistant voices available to shops."],
            ["/admin/settings/security", "Security", "Authenticator, backup codes, operator reset."],
            ["/admin/settings/audit", "Audit log", "Every admin change, newest first."],
          ].map(([href, label, note]) => (
            <li key={href}>
              <Link href={href} className="flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-3 hover:bg-surface-2">
                <span className="font-semibold text-ink">{label}</span>
                <span className="min-w-0 flex-1 text-end text-ops-label text-ink-2 md:text-start">{note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="How number hold works" className="border border-hairline bg-surface">
        <h2 className="flex items-baseline justify-between gap-ops-4 border-b border-hairline px-ops-3 py-ops-2 text-ops-label font-semibold uppercase tracking-wide text-ink-2">
          <span>How it works</span>
          <span className="font-normal normal-case tracking-normal">using the values above</span>
        </h2>
        <ol className="divide-y divide-hairline text-ops-body">
          {[
            ["Line stops", "Trial ends or the line is suspended. Calls still reach the shop."],
            ["Voicemail window", "Callers can leave a message for a few days, then hear that the line is off."],
            [
              "Number hold",
              here
                ? `Hold after release is ${rows[0].value}. The number stays for ${rows[1].value.toLowerCase()} so the business can come back. Fee: ${rows[2].value}.`
                : "Hold settings are not on this environment, so this step cannot be summarised here.",
            ],
            [
              "Released",
              here && rows[0].value === "Off"
                ? "Hold is Off: the number goes back to the pool as soon as the line stops."
                : "After the hold length, the number goes back to the pool for someone else.",
            ],
          ].map(([t, n], i) => (
            <li key={t} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-ops-3 px-ops-3 py-ops-3">
              <span className="tabular-nums text-ink-2">{i + 1}</span>
              <span>
                <span className="font-semibold text-ink">{t}</span>
                <span className="mt-0.5 block text-ops-label text-ink-2">{n}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <OpsConfirm
        open={confirm}
        onClose={() => { if (!pending) setConfirm(false); }}
        onConfirm={(reason) => { void save(reason); }}
        title="Save number-hold settings?"
        strength="money"
        requireReason
        confirmLabel="Save settings"
        pending={pending}
        amount={clearFee || feeText.trim() === "" ? undefined : Number(feeText) || undefined}
      >
        {error ? <p className="pb-2 text-attention" role="alert">{error}</p> : null}
        <p>
          Hold after release: <strong className="text-ink">{enabled ? "On" : "Off"}</strong>. Default length:{" "}
          <strong className="text-ink">{clampHoldDays(days, 14)} days</strong>. Fee:{" "}
          <strong className="text-ink">{clearFee || feeText.trim() === "" ? "None" : `KSh ${Number(feeText).toLocaleString("en-KE")}`}</strong>.
        </p>
        <p className="text-ops-label text-ink-2">{feeSurface.note}</p>
      </OpsConfirm>
    </div>
  );
}
