"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "./Drawer";

/**
 * Platform Unlock. One sheet for every sensitive Admin write: bottom sheet on phones,
 * right drawer from md (Drawer). Unlock proves the operator for the next ~10 minutes —
 * it never changes domain state alone. The server gate (stepUpGate) is the real check.
 * observe: Check access logs would-require-step-up.
 * enforce (ADMIN_STEP_UP_ENFORCE=on): authenticator code, backup code, or first-time setup.
 */
type Status = { mode: "off" | "observe" | "enforce"; enrolled?: boolean; needsReenrol?: boolean; lockedUntil?: string | null; unlockedUntil?: string | null };
type View = "loading" | "observe" | "code" | "backup" | "setup_intro" | "setup_scan" | "setup_codes" | "unlocked";

const timeOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

export function StepUpSheet({
  open, onClose, action, target, what, onObserved, observedHint,
}: {
  open: boolean;
  onClose: () => void;
  action: string;
  target?: string | null;
  what: string;
  onObserved?: () => void;
  observedHint?: string;
}) {
  const [view, setView] = useState<View>("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const [state, setState] = useState<"idle" | "pending" | "observed" | "not_enrolled" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);
  const codesText = (codes: string[]) => `Scalers Admin backup codes. Each works once.\n\n${codes.join("\n")}\n`;
  const downloadCodes = (codes: string[]) => {
    const url = URL.createObjectURL(new Blob([codesText(codes)], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "scalers-admin-backup-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  };
  const copyCodes = async (codes: string[]) => {
    try { await navigator.clipboard.writeText(codesText(codes)); setCopied(true); } catch { setCopied(false); }
  };
  const [unlockedUntil, setUnlockedUntil] = useState<string | null>(null);
  const [needsReenrol, setNeedsReenrol] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setView("loading");
    fetch("/api/admin/step-up", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { mode: "observe" }))
      .then((s: Status) => {
        if (!live) return;
        setStatus(s);
        if (s.mode !== "enforce") return setView("observe");
        setNeedsReenrol(!!s.needsReenrol);
        if (s.unlockedUntil) { setUnlockedUntil(s.unlockedUntil); return setView("unlocked"); }
        setView(s.enrolled ? "code" : "setup_intro");
      })
      .catch(() => live && setView("observe"));
    return () => { live = false; };
  }, [open]);

  const close = () => {
    setState("idle"); setMsg(null); setCode(""); setSetup(null); setBackupCodes(null); setCopied(false); onClose();
  };
  const post = async (url: string, body: unknown) => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { res, json } as { res: Response; json: Record<string, unknown> };
  };

  const check = async () => {
    setState("pending");
    try {
      const res = await fetch("/api/admin/step-up", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, target: target ?? null }),
      });
      if (res.status === 501) return setState("not_enrolled");
      if (!res.ok) return setState("error");
      setState("observed");
      onObserved?.();
    } catch {
      setState("error");
    }
  };

  const unlock = async () => {
    setState("pending"); setMsg(null);
    try {
      const { res, json } = await post("/api/admin/step-up", {
        action, target: target ?? null, ...(view === "backup" ? { backupCode: code } : { code }),
      });
      setCode("");
      if (!res.ok) { setState("idle"); return setMsg(String(json.message || "Couldn't unlock. Try again.")); }
      setState("idle");
      setUnlockedUntil(String(json.unlockedUntil || ""));
      setNeedsReenrol(!!json.needsReenrol);
      setView("unlocked");
      onObserved?.();
    } catch {
      setState("error");
    }
  };

  const startSetup = async () => {
    setState("pending"); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/enrol", { op: "start" });
    setState("idle");
    if (!res.ok) return setMsg(String(json.message || "Couldn't start setup."));
    setSetup({ secret: String(json.secret), qrSvg: String(json.qrSvg) });
    setView("setup_scan");
  };

  const confirmSetup = async () => {
    setState("pending"); setMsg(null);
    const { res, json } = await post("/api/admin/step-up/enrol", { op: "confirm", code });
    setState("idle"); setCode("");
    if (!res.ok) return setMsg(String(json.message || "That code didn't work."));
    setBackupCodes((json.backupCodes as string[]) || []);
    setUnlockedUntil(String(json.unlockedUntil || ""));
    setNeedsReenrol(false);
    setView("setup_codes");
  };

  const pending = state === "pending";
  const enforce = status?.mode === "enforce";
  const codeOk = view === "backup" ? code.replace(/[^a-z0-9]/gi, "").length === 10 : /^\d{6}$/.test(code);

  let footer: ReactNode;
  if (!enforce) {
    footer = (
      <div className="flex w-full flex-col gap-ops-2" data-stepup-footer="">
        {state === "idle" ? <p className="text-right text-ops-label text-ink-2" data-blocked-why="">Code entry turns on when Unlock is enforced.</p> : null}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={close} disabled={pending}>{state === "observed" ? "Done" : "Cancel"}</Button>
          {state !== "observed" ? (
            <Button variant="primary" size="md" pending={pending} onClick={check} data-action="stepup-check" disabled={view === "loading"}>Check access</Button>
          ) : null}
        </div>
      </div>
    );
  } else if (view === "code" || view === "backup") {
    footer = (
      <div className="flex w-full items-center justify-end gap-2" data-stepup-footer="">
        <Button variant="ghost" size="md" onClick={close} disabled={pending}>Cancel</Button>
        <Button variant="primary" size="md" pending={pending} onClick={unlock} disabled={!codeOk} data-action="stepup-unlock">Unlock</Button>
      </div>
    );
  } else if (view === "setup_intro") {
    footer = (
      <div className="flex w-full items-center justify-end gap-2" data-stepup-footer="">
        <Button variant="ghost" size="md" onClick={close} disabled={pending}>Not now</Button>
        <Button variant="primary" size="md" pending={pending} onClick={startSetup} data-action="stepup-setup">Set up authenticator</Button>
      </div>
    );
  } else if (view === "setup_scan") {
    footer = (
      <div className="flex w-full items-center justify-end gap-2" data-stepup-footer="">
        <Button variant="ghost" size="md" onClick={close} disabled={pending}>Cancel</Button>
        <Button variant="primary" size="md" pending={pending} onClick={confirmSetup} disabled={!codeOk} data-action="stepup-confirm">Confirm code</Button>
      </div>
    );
  } else {
    footer = (
      <div className="flex w-full items-center justify-end gap-2" data-stepup-footer="">
        <Button variant="primary" size="md" onClick={close} data-action="stepup-done">{view === "setup_codes" ? "I've saved these" : "Done"}</Button>
      </div>
    );
  }

  const codeField = (label: string, backup = false) => (
    <label className="flex flex-col gap-1 border-t border-hairline pt-ops-3">
      <span className="text-ops-label font-semibold text-ink">{label}</span>
      <input
        value={code}
        onChange={(e) => setCode(backup ? e.target.value.slice(0, 11) : e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode={backup ? "text" : "numeric"}
        autoComplete="one-time-code"
        autoFocus
        placeholder={backup ? "xxxxx-xxxxx" : "6 digits"}
        className="ops-field text-ink"
        data-field="code"
        onKeyDown={(e) => { if (e.key === "Enter" && codeOk && !pending) void (view === "setup_scan" ? confirmSetup() : unlock()); }}
      />
    </label>
  );

  return (
    <Drawer open={open} title="Unlock" dismissible={!pending && view !== "setup_codes"} onOpenChange={(next) => { if (!next) close(); }} footer={footer}>
      <div className="ops-theme flex flex-col gap-ops-3 text-ops-body text-ink" data-stepup-sheet="" data-action-key={action} data-stepup-view={view}>
        <p>
          Unlock lets you <span className="font-semibold">{what}</span>. It doesn&apos;t change anything by itself.
        </p>

        {view === "loading" ? <p className="text-ops-label text-ink-2" role="status">Checking…</p> : null}

        {view === "observe" ? (
          <>
            <p className="text-ops-label text-ink-2" data-stepup-observe="">Unlock isn&apos;t enforced here yet, so no code is needed.</p>
            {state === "observed" ? (
              <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status" data-stepup-result="observed">
                Observe mode: logged that this would need a code. You can go ahead with the action as usual.
                {observedHint ? <span className="mt-1 block">{observedHint}</span> : null}
              </p>
            ) : null}
            {state === "not_enrolled" ? (
              <p className="text-ops-label text-attention" role="alert" data-stepup-result="not_enrolled">Authenticator not set up yet.</p>
            ) : null}
          </>
        ) : null}

        {view === "code" ? (
          <>
            {codeField("Code from your authenticator app")}
            <p className="text-ops-label text-ink-2">Unlock lasts 10 minutes. 5 wrong codes lock Unlock for 15 minutes.</p>
            <button type="button" className="self-start text-ops-label text-ink underline" onClick={() => { setCode(""); setMsg(null); setView("backup"); }}>
              Lost your phone? Use a backup code
            </button>
          </>
        ) : null}

        {view === "backup" ? (
          <>
            {codeField("Backup code", true)}
            <p className="text-ops-label text-ink-2">Each backup code works once. After this you&apos;ll set up the authenticator again on your new phone.</p>
            <button type="button" className="self-start text-ops-label text-ink underline" onClick={() => { setCode(""); setMsg(null); setView("code"); }}>
              Use the authenticator code instead
            </button>
          </>
        ) : null}

        {view === "setup_intro" ? (
          <p className="text-ops-label text-ink-2" data-stepup-result="not_enrolled">
            Authenticator not set up yet. You&apos;ll scan a QR code with an app like Google Authenticator, then save 10 backup codes.
          </p>
        ) : null}

        {view === "setup_scan" && setup ? (
          <>
            <p className="text-ops-label text-ink-2">Scan this with your authenticator app, then enter the 6-digit code it shows.</p>
            <div className="mx-auto w-48 rounded-sm border border-hairline bg-white p-2" aria-label="Authenticator QR code" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
            <div className="flex flex-col gap-1">
              <span className="text-ops-label text-ink-2">Can&apos;t scan? Type this key:</span>
              <code className="break-all rounded-sm border border-hairline bg-canvas px-ops-2 py-1 font-mono text-ops-label text-ink" data-stepup-secret="">
                {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
              </code>
            </div>
            {codeField("Code from the app")}
          </>
        ) : null}

        {view === "setup_codes" && backupCodes ? (
          <>
            <p className="text-ops-label font-semibold text-ink">Save these backup codes now. They won&apos;t be shown again.</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-ops-label text-ink" data-stepup-backup-codes="">
              {backupCodes.map((c) => <li key={c} className="rounded-sm border border-hairline bg-canvas px-ops-2 py-1">{c}</li>)}
            </ul>
            <div className="flex flex-wrap gap-ops-2">
              <Button variant="tonal" size="md" onClick={() => downloadCodes(backupCodes)} data-action="stepup-codes-download">Download (.txt)</Button>
              <Button variant="tonal" size="md" onClick={() => void copyCodes(backupCodes)} data-action="stepup-codes-copy">{copied ? "Copied" : "Copy"}</Button>
            </div>
            <p className="text-ops-label text-ink-2">Store them in a password manager or print them. Each works once if you lose your phone. We never email backup codes.</p>
          </>
        ) : null}

        {view === "unlocked" ? (
          <p className="rounded-sm border border-hairline bg-canvas px-ops-3 py-ops-2 text-ops-label text-ink-2" role="status" data-stepup-result="unlocked">
            Unlocked until {timeOf(unlockedUntil)}. Go ahead with the action.
            {needsReenrol ? <span className="mt-1 block text-attention">You used a backup code. Set up your authenticator again now.</span> : null}
          </p>
        ) : null}
        {view === "unlocked" && needsReenrol ? (
          <Button variant="ghost" size="md" onClick={startSetup} pending={pending} data-action="stepup-reenrol">Set up authenticator again</Button>
        ) : null}

        {msg ? <p className="text-ops-label text-attention" role="alert">{msg}</p> : null}
        {state === "error" ? <p className="text-ops-label text-attention" role="alert">Couldn&apos;t check access. Try again.</p> : null}
      </div>
    </Drawer>
  );
}
