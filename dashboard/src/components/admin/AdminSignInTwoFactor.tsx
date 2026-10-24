"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

/**
 * Second sign-in step for Super Admin (ADMIN_STEP_UP_ENFORCE=on). Authenticator first, email code
 * as the fallback, backup code for a lost phone. Inline panel, never a centred modal.
 */
type Status = { required: boolean; passed?: boolean; operator?: string; enrolled?: boolean; emailHint?: string | null; lockedUntil?: string | null };
type Mode = "totp" | "email" | "backup";

const timeOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export function AdminSignInTwoFactor({ fieldClass }: { fieldClass: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/sign-in-2fa", { cache: "no-store" })
      .then((r) => r.json())
      .then((s: Status) => {
        if (!s.required || s.passed) return window.location.assign("/admin");
        setStatus(s);
        setLockedUntil(s.lockedUntil ?? null);
        setMode(s.enrolled ? "totp" : "email");
      })
      .catch(() => setMsg("Couldn't load the sign-in check. Refresh the page."));
  }, []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/sign-in-2fa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { res, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  const sendEmail = async () => {
    setPending(true); setMsg(null);
    const { res, json } = await post({ op: "email_send" });
    setPending(false);
    if (json.lockedUntil) setLockedUntil(String(json.lockedUntil));
    if (!res.ok) return setMsg(String(json.message || "Couldn't send the code."));
    setSentTo(String(json.sentTo || ""));
  };

  const verify = async () => {
    setPending(true); setMsg(null);
    const op = mode === "totp" ? "totp" : mode === "backup" ? "backup" : "email_verify";
    const { res, json } = await post({ op, code });
    setCode("");
    if (res.ok) return window.location.assign(String(json.next || "/admin"));
    setPending(false);
    if (json.lockedUntil) setLockedUntil(String(json.lockedUntil));
    setMsg(String(json.message || "That code didn't work."));
  };

  const switchTo = (m: Mode) => { setMode(m); setCode(""); setMsg(null); };
  const codeOk = mode === "backup" ? code.replace(/[^a-z0-9]/gi, "").length === 10 : /^\d{6}$/.test(code);
  const locked = !!lockedUntil && Date.parse(lockedUntil) > Date.now();

  if (!status) {
    return <p className="mt-8 text-body text-ink-2" role="status">{msg || "Checking…"}</p>;
  }

  const label = mode === "totp" ? "Code from your authenticator app" : mode === "backup" ? "Backup code" : "Code from your email";

  return (
    <form
      className="glass-chrome mt-8 space-y-4 rounded-panel border border-hairline p-6"
      data-admin-2fa=""
      data-admin-2fa-mode={mode}
      onSubmit={(e) => { e.preventDefault(); if (codeOk && !pending && !locked) void verify(); }}
    >
      <div className="space-y-1">
        <h2 className="text-body font-semibold text-ink">Confirm it&apos;s you</h2>
        <p className="text-body text-ink-2">
          Signed in as <span className="font-medium text-ink">{status.operator}</span>. This device stays confirmed for 12 hours.
        </p>
      </div>

      {!status.enrolled && mode === "email" ? (
        <p className="text-body text-ink-2" data-admin-2fa-setup-next="">
          You haven&apos;t set up an authenticator yet. Use an email code now, then you&apos;ll set one up.
        </p>
      ) : null}

      {mode === "email" ? (
        status.emailHint ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-body text-ink-2">{sentTo ? `Sent to ${sentTo}. It expires in 10 minutes.` : `We'll email a 6-digit code to ${status.emailHint}.`}</p>
            <Button type="button" variant="tonal" size="md" pending={pending && !code} onClick={sendEmail} disabled={locked} data-action="admin-2fa-email-send">
              {sentTo ? "Send again" : "Email me a code"}
            </Button>
          </div>
        ) : (
          <p className="text-body text-warn" role="alert">No email is set for sign-in codes. Ask another operator to check ADMIN_STEP_UP_ALERT_EMAIL.</p>
        )
      ) : null}

      {mode !== "email" || sentTo ? (
        <div>
          <label className="block text-body font-medium text-ink" htmlFor="admin-2fa-code">{label}</label>
          <input
            id="admin-2fa-code"
            name="code"
            value={code}
            onChange={(e) => setCode(mode === "backup" ? e.target.value.slice(0, 11) : e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode={mode === "backup" ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            spellCheck={false}
            placeholder={mode === "backup" ? "xxxxx-xxxxx" : "6 digits"}
            aria-invalid={msg ? true : undefined}
            aria-describedby={msg ? "admin-2fa-error" : undefined}
            className={`mt-2 ${fieldClass}`}
            data-field="code"
          />
        </div>
      ) : null}

      {locked ? (
        <p className="text-body text-warn" role="alert">Too many wrong codes. Try again after {timeOf(lockedUntil)}.</p>
      ) : msg ? (
        <p id="admin-2fa-error" className="text-body text-warn" role="alert">{msg}</p>
      ) : null}

      {mode !== "email" || sentTo ? (
        <Button type="submit" className="w-full" pending={pending && !!code} disabled={!codeOk || locked} data-action="admin-2fa-verify">
          Continue
        </Button>
      ) : null}

      <div className="flex flex-col items-start gap-2 border-t border-hairline pt-4">
        {mode !== "totp" && status.enrolled ? (
          <button type="button" className="min-h-11 text-body text-ink underline" onClick={() => switchTo("totp")} data-action="admin-2fa-use-totp">Use authenticator code</button>
        ) : null}
        {mode !== "email" && status.emailHint ? (
          <button type="button" className="min-h-11 text-body text-ink underline" onClick={() => switchTo("email")} data-action="admin-2fa-use-email">Use email code instead</button>
        ) : null}
        {mode !== "backup" && status.enrolled ? (
          <button type="button" className="min-h-11 text-body text-ink underline" onClick={() => switchTo("backup")} data-action="admin-2fa-use-backup">Use a backup code</button>
        ) : null}
      </div>
    </form>
  );
}
