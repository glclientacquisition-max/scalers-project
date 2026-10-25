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

const notNowBtn =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-4 text-body font-medium text-ink-2 hover:bg-hairline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand";

function ShareGlyph() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block align-[-3px]">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  );
}

function AddGlyph() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="inline-block align-[-3px]">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/** Pure view (dev harness renders both variants). */
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
      data-install-card={platform}
      className="fixed inset-x-3 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-2xl border border-hairline bg-surface p-4 shadow-lg md:bottom-6"
    >
      <p id="install-card-title" className="text-body font-semibold text-ink">
        <span lang="sw" className="block">Weka Scalers kwenye simu yako</span>
        <span className="block font-normal text-ink-2">Add Scalers to your phone</span>
      </p>
      {platform === "ios" ? (
        <ol className="mt-3 space-y-1.5 text-meta text-ink-2">
          <li>1. Tap Share <ShareGlyph /> in Safari</li>
          <li>2. Tap Add to Home Screen <AddGlyph /></li>
          <li>3. Open Scalers from the new icon</li>
        </ol>
      ) : (
        <p className="mt-2 text-meta text-ink-2">Opens like an app. Uses little data.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button type="button" className={notNowBtn} onClick={onNotNow}>
          Not now
        </button>
        {platform === "android" ? (
          <button type="button" className={`${btnPrimary} min-h-11`} onClick={onInstall}>
            Install
          </button>
        ) : (
          <button type="button" className={`${btnPrimary} min-h-11`} onClick={onNotNow}>
            Got it
          </button>
        )}
      </div>
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
