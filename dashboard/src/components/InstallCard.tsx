"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { btnPrimary } from "@/components/ui/deskChrome";
import { useDeskNeedsCount } from "@/components/DeskNavState";
import {
  INSTALL_SNOOZE_KEY,
  INSTALL_SNOOZE_MS,
  INSTALL_VISITS_KEY,
  installPlatform,
  shouldShowInstallCard,
  type InstallPlatform,
} from "@/lib/pwa";
import { isStandalone } from "@/lib/pushClient";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SEEN_CALL_KEY = "scalers-seen-call";
const VISIT_SESSION_KEY = "scalers-visit-counted";

const secondaryBtn =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-hairline bg-surface px-3 text-body font-medium text-ink hover:bg-surface-2 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function ShareGlyph() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block shrink-0 align-[-2px] text-accent">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function AddGlyph() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline-block shrink-0 align-[-2px] text-accent">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

const IOS_STEPS = [
  <>Tap Share <ShareGlyph /> in Safari</>,
  <>Tap Add to Home Screen <AddGlyph /></>,
  <>Open Scalers from the new icon</>,
];

/** Pure view (dev harness renders both variants). Lines wrap, never truncate, so Kiswahili fits at 360. */
export function InstallCardView({
  platform,
  onInstall,
  onNotNow,
}: {
  platform: "android" | "ios";
  onInstall?: () => void;
  onNotNow?: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-labelledby="install-card-title"
      aria-describedby="install-card-body"
      data-install-card={platform}
      className="fixed inset-x-3 bottom-[calc(var(--desk-tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-40 mx-auto max-w-md rounded-2xl border border-hairline bg-surface p-3 shadow-sheet md:bottom-6"
    >
      <div className="flex items-start gap-3">
        {/* The real home-screen icon, so the owner knows what to look for afterwards. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-xl border border-hairline bg-canvas p-1" />
        <div className="min-w-0 flex-1">
          <p id="install-card-title" className="text-body font-semibold leading-snug text-ink">
            Add Scalers to your phone
          </p>
          <p lang="sw" className="text-meta leading-snug text-ink-2">
            Weka Scalers kwenye simu yako
          </p>
        </div>
      </div>
      {platform === "ios" ? (
        <ol id="install-card-body" className="mt-3 space-y-2 border-t border-hairline pt-3">
          {IOS_STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-2.5 text-meta leading-snug text-ink">
              <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-tonal text-[0.75rem] font-semibold tabular-nums text-accent">
                {i + 1}
              </span>
              <span className="min-w-0 pt-px">{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p id="install-card-body" className="mt-2 text-meta leading-snug text-ink-2">
          It opens from your home screen, like an app.
        </p>
      )}
      {platform === "android" ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className={secondaryBtn} onClick={onNotNow}>
            Not now
          </button>
          <button type="button" className={`${btnPrimary} min-h-11 w-full`} onClick={onInstall}>
            Install
          </button>
        </div>
      ) : (
        <div className="mt-3">
          <button type="button" className={secondaryBtn} onClick={onNotNow}>
            Got it
          </button>
        </div>
      )}
    </div>
  );
}

/** Desk shell: shows after value (a call in the Inbox, or the second visit). Never on admin. */
export function InstallCard() {
  const pathname = usePathname() || "/";
  const needs = useDeskNeedsCount();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  const [visits, setVisits] = useState(0);
  const [snoozedUntil, setSnoozedUntil] = useState(Number.MAX_SAFE_INTEGER);
  const [seenCall, setSeenCall] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    try {
      let v = Number(localStorage.getItem(INSTALL_VISITS_KEY) || "0");
      if (!sessionStorage.getItem(VISIT_SESSION_KEY)) {
        v += 1;
        localStorage.setItem(INSTALL_VISITS_KEY, String(v));
        sessionStorage.setItem(VISIT_SESSION_KEY, "1");
      }
      setVisits(v);
      setSnoozedUntil(Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || "0"));
      setSeenCall(localStorage.getItem(SEEN_CALL_KEY) === "1");
    } catch {
      /* private mode: stay hidden */
    }
    setPlatform(installPlatform(navigator.userAgent, isStandalone()));
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (seenCall || !pathname.startsWith("/calls")) return;
    if (document.querySelector("[data-inbox-row-body]")) {
      try {
        localStorage.setItem(SEEN_CALL_KEY, "1");
      } catch {
        /* ignore */
      }
      setSeenCall(true);
    }
  }, [pathname, seenCall]);

  const show = shouldShowInstallCard({
    pathname,
    platform,
    hasCall: seenCall || needs > 0,
    visits,
    snoozedUntil,
    now: Date.now(),
    canPrompt: Boolean(deferred),
  });
  if (!show || (platform !== "android" && platform !== "ios")) return null;

  function notNow() {
    const until = Date.now() + INSTALL_SNOOZE_MS;
    try {
      localStorage.setItem(INSTALL_SNOOZE_KEY, String(until));
    } catch {
      /* ignore */
    }
    setSnoozedUntil(until);
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    setDeferred(null);
    if (choice.outcome !== "accepted") notNow();
  }

  return <InstallCardView platform={platform} onInstall={install} onNotNow={notNow} />;
}
