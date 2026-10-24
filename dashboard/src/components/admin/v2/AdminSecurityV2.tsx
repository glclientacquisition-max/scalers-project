"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { OpsConfirm, PageHeader, StepUpSheet } from "@/components/ops";
import { SECURITY_EVENT_WORDS } from "@/lib/ops/stepUpWords";
import "@/styles/ops.css";

type Op = { name: string; enrolled: boolean; needsReenrol: boolean; lockedUntil: string | null };
type Ev = { id: string; created_at: string; actor: string; action: string };
export type SecurityData = {
  me: string;
  enrolledAt: string | null;
  needsReenrol: boolean;
  codesLeft: number;
  emailHint: string | null;
  emailSource: "operator" | "alert" | null;
  deviceUntil: string | null;
  unlockedUntil: string | null;
  protects: string[];
  operators: Op[];
  events: Ev[];
  /** null = the area table couldn't be read (everything still needs Unlock). */
  areas: Area[] | null;
};
type Area = {
  id: string; title: string; covers: string; required: boolean; updatedBy: string | null; updatedAt: string | null;
  switchable: string[]; always: Array<{ what: string; why: string }>;
};

const EAT = (iso: string, withDate = true) =>
  `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
  }).format(new Date(iso))} EAT`;

const card = "border border-hairline bg-surface";
const head = "border-b border-hairline px-ops-3 py-ops-2 text-ops-label font-semibold uppercase tracking-wide text-ink-2";
const rowCls = "flex min-h-ops-touch items-baseline justify-between gap-ops-4 px-ops-3 py-ops-2";

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className={rowCls}>
      <dt className="text-ink-2">{k}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? Math.max(0, Date.parse(until) - now) : 0;
  return { left, text: `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` };
}

/**
 * Settings › Security (ADMIN_V2). Six plain sections: your sign-in, backup codes, Unlock,
 * what needs Unlock (area switches), operators, recent activity. Every button calls a real route; confirms use OpsConfirm
 * (bottom sheet on phones, side drawer from md). A 403 step_up_required opens StepUpSheet.
 */
export function AdminSecurityV2({ mode, data, openSetup }: { mode: "off" | "observe" | "enforce"; data: SecurityData | null; openSetup: boolean }) {
  const router = useRouter();
  const [sheet, setSheet] = useState<null | { action: string; what: string; replace?: boolean }>(
    openSetup ? { action: "enrol", what: "set up your authenticator" } : null,
  );
  const [confirm, setConfirm] = useState<null | "codes" | "reset" | "forget">(null);
  const [areaAsk, setAreaAsk] = useState<null | { id: string; title: string; required: boolean }>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [target, setTarget] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const unlock = useCountdown(data?.unlockedUntil ?? null);

  if (mode !== "enforce" || !data) {
    return (
      <div className="ops-theme flex flex-col gap-ops-3 text-ops-body text-ink" data-admin-security="">
        <PageHeader title="Security" />
        <p className="border border-hairline bg-surface px-ops-3 py-ops-3 text-ink-2">
          Sign-in codes and Unlock aren&apos;t switched on here yet (ADMIN_STEP_UP_ENFORCE is off). Nothing to set up.
        </p>
      </div>
    );
  }

  const d = data;
  const enrolled = !!d.enrolledAt;
  const others = d.operators.filter((o) => o.name !== d.me);
  const unlocked = !!d.unlockedUntil && unlock.left > 0;
  const codesText = (c: string[]) => `Scalers Admin backup codes. Each works once.\n\n${c.join("\n")}\n`;
  const needUnlock = (what: string, action: string) => {
    setMsg({ tone: "warn", text: `Unlock first, then tap ${what} again.` });
    setSheet({ action, what: what.toLowerCase() });
  };

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, json };
  };

  const regenerate = async () => {
    setPending("codes"); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/backup-codes");
    setPending(null); setConfirm(null);
    if (res.status === 403) return needUnlock("Generate new codes", "step-up:regenerate_backup_codes");
    if (!res.ok) return setMsg({ tone: "warn", text: String(json.message || json.error || "Couldn't make new codes.") });
    setCodes((json.backupCodes as string[]) || []); setCopied(false);
    router.refresh();
  };

  const reset = async (reason: string) => {
    setPending("reset"); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/reset", { target, reason });
    setPending(null); setConfirm(null);
    if (res.status === 403) return needUnlock("Reset authenticator", "step-up:reset");
    if (!res.ok) return setMsg({ tone: "warn", text: String(json.message || json.error || "Couldn't reset.") });
    setMsg({ tone: "ok", text: `${target}'s authenticator is reset. They'll set it up again at their next sign-in.` });
    setTarget("");
    router.refresh();
  };

  const setArea = async (reason: string) => {
    if (!areaAsk) return;
    const ask = areaAsk;
    setPending(`area-${ask.id}`); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/areas", { area: ask.id, required: ask.required, reason });
    setPending(null); setAreaAsk(null);
    if (res.status === 403) return needUnlock(`the ${ask.title} switch`, "step-up:set_area");
    if (!res.ok) return setMsg({ tone: "warn", text: String(json.message || json.error || "Couldn't save that switch.") });
    setMsg({ tone: "ok", text: `${ask.title}: ${ask.required ? "needs Unlock" : "no longer needs Unlock"}.` });
    router.refresh();
  };

  const session = async (op: "end_unlock" | "forget_device") => {
    setPending(op); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/session", { op });
    setPending(null); setConfirm(null);
    if (!res.ok) return setMsg({ tone: "warn", text: String(json.message || json.error || "That didn't work. Try again.") });
    if (op === "forget_device") { window.location.href = String(json.next || "/admin/login?step=2fa"); return; }
    setMsg({ tone: "ok", text: "Unlock ended." });
    router.refresh();
  };

  return (
    <div className="ops-theme flex flex-col gap-ops-4 text-ops-body text-ink" data-admin-security="">
      <PageHeader title="Security" />

      {msg ? (
        <p role={msg.tone === "warn" ? "alert" : "status"} className={`border border-hairline px-ops-3 py-ops-2 text-ops-label ${msg.tone === "warn" ? "text-attention" : "text-ink-2"}`} data-security-msg="">
          {msg.text}
        </p>
      ) : null}

      <section aria-labelledby="sec-signin" className={card} data-security-signin="">
        <h2 id="sec-signin" className={head}>Your sign-in</h2>
        <dl className="divide-y divide-hairline">
          <Row k="Authenticator">
            <span data-security-enrolled={enrolled ? "yes" : "no"}>
              {enrolled ? (d.needsReenrol ? "Set up again (backup code used)" : `Set up ${EAT(d.enrolledAt!)}`) : "Not set up"}
            </span>
          </Row>
          <Row k="Email code goes to">
            {d.emailHint ? (
              <span>
                {d.emailHint}
                <span className="block text-ops-label font-normal text-ink-2">
                  {d.emailSource === "operator" ? "Your own address (ADMIN_OPERATOR_EMAILS)" : "Shared ops address (ADMIN_STEP_UP_ALERT_EMAIL)"}
                </span>
              </span>
            ) : <span className="text-ink-2">No address set</span>}
          </Row>
          <Row k="This device">
            {d.deviceUntil ? `Trusted until ${EAT(d.deviceUntil)}` : <span className="text-ink-2">Not trusted</span>}
          </Row>
        </dl>
        <div className="flex flex-wrap gap-ops-2 border-t border-hairline px-ops-3 py-ops-3">
          {!enrolled || d.needsReenrol ? (
            <Button variant="primary" size="md" onClick={() => setSheet({ action: "enrol", what: "set up your authenticator" })} data-action="security-setup">
              Set up authenticator
            </Button>
          ) : (
            <Button variant="tonal" size="md" onClick={() => setSheet({ action: "enrol", what: "replace your authenticator", replace: true })} data-action="security-replace">
              Replace authenticator
            </Button>
          )}
          {d.deviceUntil ? (
            <Button variant="ghost" size="md" pending={pending === "forget_device"} onClick={() => setConfirm("forget")} data-action="security-forget-device">
              Forget this device
            </Button>
          ) : null}
        </div>
        <p className="px-ops-3 pb-ops-3 text-ops-label text-ink-2">
          Authenticator first; the email code is the fallback. Device trust lives in this browser only, so forgetting it signs this device out of the second step. Other devices expire on their own within 12 hours.
        </p>
      </section>

      <section aria-labelledby="sec-codes" className={card} data-security-backup="">
        <h2 id="sec-codes" className={head}>Backup codes</h2>
        <dl><Row k="Codes left"><span className="ops-num">{enrolled ? d.codesLeft : "—"}</span></Row></dl>
        {enrolled ? (
          <div className="flex flex-wrap gap-ops-2 border-t border-hairline px-ops-3 py-ops-3">
            <Button variant="tonal" size="md" pending={pending === "codes"} onClick={() => setConfirm("codes")} data-action="security-new-codes">
              Generate new codes
            </Button>
          </div>
        ) : null}
        <p className="px-ops-3 pb-ops-3 text-ops-label text-ink-2">
          {enrolled ? "Needs Unlock. Shown once, never emailed. Old codes stop working." : "You get backup codes when you set up the authenticator."}
        </p>
        {codes ? (
          <div className="border-t border-hairline" data-security-codes="">
            <p className="px-ops-3 pt-ops-3 text-ops-label font-semibold">Save these now. They won&apos;t be shown again.</p>
            <ul className="grid grid-cols-2 gap-1 p-ops-3 font-mono text-ops-label">
              {codes.map((c) => <li key={c} className="rounded-sm border border-hairline bg-canvas px-ops-2 py-1">{c}</li>)}
            </ul>
            <div className="flex flex-wrap gap-ops-2 px-ops-3 pb-ops-3">
              <Button variant="tonal" size="md" onClick={() => {
                const url = URL.createObjectURL(new Blob([codesText(codes)], { type: "text/plain" }));
                const a = document.createElement("a"); a.href = url; a.download = "scalers-admin-backup-codes.txt"; a.click(); URL.revokeObjectURL(url);
              }} data-action="security-codes-download">Download (.txt)</Button>
              <Button variant="tonal" size="md" onClick={() => { void navigator.clipboard.writeText(codesText(codes)).then(() => setCopied(true)).catch(() => setMsg({ tone: "warn", text: "Couldn't copy. Use Download." })); }} data-action="security-codes-copy">{copied ? "Copied" : "Copy"}</Button>
              <Button variant="ghost" size="md" onClick={() => setCodes(null)}>I&apos;ve saved these</Button>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="sec-unlock" className={card} data-security-unlock="">
        <h2 id="sec-unlock" className={head}>Unlock</h2>
        <dl>
          <Row k="Now">
            <span data-security-unlocked={unlocked ? "yes" : "no"}>
              {unlocked ? <>Unlocked · <span className="ops-num">{unlock.text}</span> left</> : <span className="text-ink-2">Locked</span>}
            </span>
          </Row>
        </dl>
        {unlocked ? (
          <div className="border-t border-hairline px-ops-3 py-ops-3">
            <Button variant="tonal" size="md" pending={pending === "end_unlock"} onClick={() => session("end_unlock")} data-action="security-end-unlock">End now</Button>
          </div>
        ) : null}
        <div className="border-t border-hairline px-ops-3 py-ops-3">
          <p className="text-ops-label text-ink-2">Unlock asks for your authenticator code and lasts 10 minutes. It&apos;s needed to:</p>
          <ul className="mt-ops-2 list-disc ps-5 text-ops-label" data-security-protects="">
            {d.protects.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      </section>

      <section aria-labelledby="sec-areas" className={card} data-security-areas="">
        <h2 id="sec-areas" className={head}>What needs Unlock</h2>
        <p className="px-ops-3 pt-ops-3 text-ops-label text-ink-2">
          Turn an area off and its everyday changes go through without a code. Changing a switch needs Unlock and a reason, and is logged. Items with a lock always need Unlock.
        </p>
        {d.areas === null ? (
          <p role="alert" className="px-ops-3 py-ops-3 text-ops-label text-attention">Couldn&apos;t read the switches, so every area needs Unlock for now.</p>
        ) : (
          <ul className="divide-y divide-hairline" data-security-area-list="">
            {d.areas.map((a) => (
              <li key={a.id} className="flex flex-col gap-ops-2 px-ops-3 py-ops-3" data-security-area={a.id}>
                <div className="flex items-start justify-between gap-ops-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{a.title}</p>
                    <p className="text-ops-label text-ink-2">{a.covers}</p>
                  </div>
                  {a.switchable.length ? (
                    <button
                      type="button" role="switch" aria-checked={a.required} aria-label={`${a.title} needs Unlock`}
                      disabled={pending === `area-${a.id}`}
                      onClick={() => setAreaAsk({ id: a.id, title: a.title, required: !a.required })}
                      className={`relative inline-flex h-ops-touch min-w-[3.25rem] shrink-0 items-center rounded-full border border-hairline px-1 transition-colors disabled:opacity-60 ${a.required ? "bg-ink" : "bg-canvas"}`}
                      data-action={`security-area-${a.id}`}
                    >
                      <span aria-hidden className={`block size-5 rounded-full transition-transform ${a.required ? "translate-x-5 bg-surface" : "translate-x-0 bg-ink-2"}`} />
                    </button>
                  ) : <span className="text-ops-label text-ink-2">Always on</span>}
                </div>
                {a.switchable.length ? (
                  <p className="text-ops-label">
                    <span className="font-semibold">{a.required ? "Needs Unlock: " : "No Unlock: "}</span>
                    {a.switchable.join(", ")}
                  </p>
                ) : null}
                {a.always.length ? (
                  <ul className="flex flex-col gap-1 text-ops-label" data-security-area-always="">
                    {a.always.map((x) => (
                      <li key={x.what} className="flex gap-ops-2">
                        <svg aria-hidden viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 fill-current text-ink-2"><path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5A1.5 1.5 0 0 1 12.5 15h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z"/></svg>
                        <span><span className="font-semibold">Always: {x.what}.</span> <span className="text-ink-2">{x.why}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {a.updatedBy && a.updatedAt ? (
                  <p className="text-ops-label text-ink-2">Last changed by {a.updatedBy}, <span className="ops-num">{EAT(a.updatedAt)}</span></p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="sec-ops" className={card} data-security-operators="">
        <h2 id="sec-ops" className={head}>Operators</h2>
        <ul className="divide-y divide-hairline">
          {d.operators.map((o) => (
            <li key={o.name} className={rowCls}>
              <span className="font-semibold">{o.name}{o.name === d.me ? <span className="ms-1 font-normal text-ink-2">(you)</span> : null}</span>
              <span className="text-ops-label text-ink-2">{o.lockedUntil ? "Locked" : o.enrolled ? (o.needsReenrol ? "Must set up again" : "Authenticator set up") : "Not set up"}</span>
            </li>
          ))}
        </ul>
        {others.length === 0 ? (
          <p className="border-t border-hairline px-ops-3 py-ops-3 text-ops-label text-ink-2">You&apos;re the only operator. If you lose your phone and backup codes, use the database reset in the runbook.</p>
        ) : (
          <div className="flex flex-col gap-ops-2 border-t border-hairline px-ops-3 py-ops-3">
            <label className="flex flex-col gap-1">
              <span className="text-ops-label font-semibold">Reset an operator&apos;s authenticator</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="ops-field text-ink" data-field="reset-target">
                <option value="">Pick an operator</option>
                {others.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
              </select>
            </label>
            <div>
              <Button variant="danger" size="md" disabled={!target} onClick={() => setConfirm("reset")} data-action="security-reset">Reset authenticator</Button>
            </div>
            <p className="text-ops-label text-ink-2">Needs Unlock and a reason. You can&apos;t reset yourself.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="sec-activity" className={card} data-security-activity="">
        <h2 id="sec-activity" className={head}>Recent security activity</h2>
        {d.events.length === 0 ? (
          <p className="px-ops-3 py-ops-3 text-ink-2">Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-hairline">
            {d.events.map((e) => (
              <li key={e.id} className="flex flex-col gap-0.5 px-ops-3 py-ops-2">
                <span>{SECURITY_EVENT_WORDS[e.action] || e.action}</span>
                <span className="text-ops-label text-ink-2"><span className="ops-num">{EAT(e.created_at)}</span> · {e.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <OpsConfirm open={confirm === "codes"} onClose={() => setConfirm(null)} onConfirm={() => void regenerate()} title="Generate new backup codes?" strength="light" confirmLabel="Generate" pending={pending === "codes"}>
        <p>Your {d.codesLeft} current codes stop working right away. The new ones are shown once.</p>
      </OpsConfirm>
      <OpsConfirm open={confirm === "reset"} onClose={() => setConfirm(null)} onConfirm={(r) => void reset(r)} title={`Reset ${target}'s authenticator?`} strength="destructive" typeToConfirm={target} requireReason reasonHint="Lost phone and backup codes" confirmLabel="Reset" pending={pending === "reset"}>
        <p>Their authenticator and backup codes stop working. They set it up again at their next sign-in.</p>
      </OpsConfirm>
      <OpsConfirm open={confirm === "forget"} onClose={() => setConfirm(null)} onConfirm={() => void session("forget_device")} title="Forget this device?" strength="light" confirmLabel="Forget" pending={pending === "forget_device"}>
        <p>You&apos;ll be asked for a code right away on this device.</p>
      </OpsConfirm>

      <OpsConfirm open={!!areaAsk} onClose={() => setAreaAsk(null)} onConfirm={(r) => void setArea(r)} title={areaAsk ? `${areaAsk.required ? "Turn on" : "Turn off"} Unlock for ${areaAsk.title}?` : ""} strength={areaAsk?.required ? "light" : "destructive"} requireReason reasonHint="Why the change" confirmLabel={areaAsk?.required ? "Turn on" : "Turn off"} pending={!!areaAsk && pending === `area-${areaAsk.id}`}>
        <p>{areaAsk?.required ? "These changes will ask for your authenticator code again." : "These changes will go through without a code. Locked items still need Unlock."}</p>
      </OpsConfirm>

      {sheet ? (
        <StepUpSheet open replace={!!sheet.replace} onClose={() => { setSheet(null); router.refresh(); }} action={sheet.action} what={sheet.what} />
      ) : null}
    </div>
  );
}
