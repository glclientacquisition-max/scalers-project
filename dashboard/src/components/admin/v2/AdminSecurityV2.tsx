"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { PageHeader, StepUpSheet } from "@/components/ops";
import "@/styles/ops.css";

type Op = { name: string; enrolled: boolean; needsReenrol: boolean; lockedUntil: string | null };

/**
 * Settings › Security (ADMIN_V2). Your authenticator status, new backup codes (needs Unlock),
 * and operator reset (needs Unlock + reason, never yourself). A 403 step_up_required from either
 * write also opens the Unlock sheet through StepUpHost.
 */
export function AdminSecurityV2({ mode, me, operators, codesLeft, openSetup }: {
  mode: "off" | "observe" | "enforce";
  me: string | null;
  operators: Op[];
  codesLeft: number;
  openSetup: boolean;
}) {
  const router = useRouter();
  const mine = operators.find((o) => o.name === me);
  const [sheet, setSheet] = useState<null | { action: string; what: string }>(
    openSetup ? { action: "enrol", what: "set up your authenticator" } : null,
  );
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  if (mode !== "enforce") {
    return (
      <div className="ops-theme flex flex-col gap-ops-3 text-ops-body text-ink" data-admin-security="">
        <PageHeader title="Security" />
        <p className="border border-hairline bg-surface px-ops-3 py-ops-3 text-ink-2">
          Authenticator sign-in and Unlock aren&apos;t switched on here yet. Nothing to set up.
        </p>
      </div>
    );
  }

  const others = operators.filter((o) => o.name !== me);
  const codesText = (c: string[]) => `Scalers Admin backup codes. Each works once.\n\n${c.join("\n")}\n`;

  const regenerate = async () => {
    setPending("codes"); setMsg(null);
    const res = await fetch("/api/admin/step-up/backup-codes", { method: "POST" });
    const json = (await res.json().catch(() => ({}))) as { backupCodes?: string[]; error?: string; message?: string };
    setPending(null);
    if (res.status === 403) return setMsg({ tone: "warn", text: "Unlock first, then tap New backup codes again." });
    if (!res.ok) return setMsg({ tone: "warn", text: json.message || json.error || "Couldn't make new codes." });
    setCodes(json.backupCodes || []);
    router.refresh();
  };

  const reset = async () => {
    setPending("reset"); setMsg(null);
    const res = await fetch("/api/admin/step-up/reset", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, reason }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    setPending(null);
    if (res.status === 403) return setMsg({ tone: "warn", text: "Unlock first, then tap Reset again." });
    if (!res.ok) return setMsg({ tone: "warn", text: json.message || json.error || "Couldn't reset." });
    setMsg({ tone: "ok", text: `${target}'s authenticator is reset. They'll set it up again at their next sign-in.` });
    setTarget(""); setReason("");
    router.refresh();
  };

  const card = "border border-hairline bg-surface";
  const head = "border-b border-hairline px-ops-3 py-ops-2 text-ops-label font-semibold uppercase tracking-wide text-ink-2";

  return (
    <div className="ops-theme flex flex-col gap-ops-4 text-ops-body text-ink" data-admin-security="">
      <PageHeader title="Security" />

      {msg ? (
        <p role={msg.tone === "warn" ? "alert" : "status"} className={`border border-hairline px-ops-3 py-ops-2 text-ops-label ${msg.tone === "warn" ? "text-attention" : "text-ink-2"}`} data-security-msg="">
          {msg.text}
        </p>
      ) : null}

      <section aria-label="Your authenticator" className={card} data-security-mine="">
        <h2 className={head}>Your authenticator</h2>
        <dl className="divide-y divide-hairline">
          <div className="flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-2">
            <dt className="text-ink-2">Status</dt>
            <dd className="font-semibold" data-security-enrolled={mine?.enrolled ? "yes" : "no"}>
              {mine?.enrolled ? (mine.needsReenrol ? "Set up again (backup code used)" : "Set up") : "Not set up"}
            </dd>
          </div>
          <div className="flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-2">
            <dt className="text-ink-2">Backup codes left</dt>
            <dd className="ops-num font-semibold">{mine?.enrolled ? codesLeft : "—"}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-ops-2 border-t border-hairline px-ops-3 py-ops-3">
          {!mine?.enrolled || mine.needsReenrol ? (
            <Button variant="primary" size="md" onClick={() => setSheet({ action: "enrol", what: "set up your authenticator" })} data-action="security-setup">
              Set up authenticator
            </Button>
          ) : (
            <Button variant="tonal" size="md" pending={pending === "codes"} onClick={regenerate} data-action="security-new-codes">
              New backup codes
            </Button>
          )}
        </div>
        <p className="px-ops-3 pb-ops-3 text-ops-label text-ink-2">New codes replace the old ones. They&apos;re shown once and never emailed.</p>
      </section>

      {codes ? (
        <section aria-label="New backup codes" className={card} data-security-codes="">
          <h2 className={head}>Save these now. They won&apos;t be shown again.</h2>
          <ul className="grid grid-cols-2 gap-1 p-ops-3 font-mono text-ops-label">
            {codes.map((c) => <li key={c} className="rounded-sm border border-hairline bg-canvas px-ops-2 py-1">{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-ops-2 px-ops-3 pb-ops-3">
            <Button variant="tonal" size="md" onClick={() => {
              const url = URL.createObjectURL(new Blob([codesText(codes)], { type: "text/plain" }));
              const a = document.createElement("a"); a.href = url; a.download = "scalers-admin-backup-codes.txt"; a.click(); URL.revokeObjectURL(url);
            }}>Download (.txt)</Button>
            <Button variant="tonal" size="md" onClick={() => { void navigator.clipboard.writeText(codesText(codes)).then(() => setCopied(true)).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</Button>
            <Button variant="ghost" size="md" onClick={() => setCodes(null)}>I&apos;ve saved these</Button>
          </div>
        </section>
      ) : null}

      <section aria-label="Operators" className={card} data-security-operators="">
        <h2 className={head}>Operators</h2>
        <ul className="divide-y divide-hairline">
          {operators.map((o) => (
            <li key={o.name} className="flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-2">
              <span className="font-semibold">{o.name}{o.name === me ? <span className="ms-1 font-normal text-ink-2">(you)</span> : null}</span>
              <span className="text-ops-label text-ink-2">{o.lockedUntil ? "Locked" : o.enrolled ? "Authenticator set up" : "Not set up"}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Reset an operator" className={card} data-security-reset="">
        <h2 className={head}>Reset an operator&apos;s authenticator</h2>
        {others.length === 0 ? (
          <p className="px-ops-3 py-ops-3 text-ink-2">You&apos;re the only operator. If you lose your phone and your backup codes, use the database reset in the runbook.</p>
        ) : (
          <div className="flex flex-col gap-ops-3 px-ops-3 py-ops-3">
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Operator</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="ops-field text-ink" data-field="reset-target">
                <option value="">Pick an operator</option>
                {others.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Reason</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="ops-field text-ink" placeholder="Lost phone and backup codes" data-field="reset-reason" />
            </label>
            <p className="text-ops-label text-ink-2">Needs Unlock. They&apos;ll set up the authenticator again at their next sign-in. You can&apos;t reset yourself here.</p>
            <div>
              <Button variant="danger" size="md" pending={pending === "reset"} disabled={!target || reason.trim().length < 3} onClick={reset} data-action="security-reset">
                Reset authenticator
              </Button>
            </div>
          </div>
        )}
      </section>

      {sheet ? (
        <StepUpSheet open onClose={() => { setSheet(null); router.refresh(); }} action={sheet.action} what={sheet.what} />
      ) : null}
    </div>
  );
}
