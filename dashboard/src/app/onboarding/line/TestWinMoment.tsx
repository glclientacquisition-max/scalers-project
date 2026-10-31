"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircleIcon } from "@heroicons/react/20/solid";
import { buttonClass } from "@/components/ui/Button";

/**
 * The first win: "Your Business Assistant answered", and the inbox item that call made.
 * Either button marks it seen (auto_seen_at), so it doesn't come back on the line step or Home.
 */
export function TestWinMoment({ from, callId, onSeen }: { from: string; callId: string | null; onSeen: () => void }) {
  const router = useRouter();
  const itemHref = callId ? `/calls/${callId}` : "/calls";
  return (
    <section
      role="status"
      aria-labelledby="test-win"
      data-test-win=""
      className="rounded-2xl border border-ok bg-ok-soft p-4"
    >
      <div className="flex items-start gap-2">
        <CheckCircleIcon aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-ok" />
        <div className="min-w-0">
          <h2 id="test-win" className="text-title font-semibold text-ink">
            Your Business Assistant answered
          </h2>
          <p className="mt-1 text-body text-ink-2">
            {from ? `Your test call from ${from} is in your inbox.` : "Your test call is in your inbox."} Real calls will
            land there too.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={itemHref}
          onClick={onSeen}
          className={buttonClass({ variant: "tonal", size: "md" })}
          data-test-win-item=""
        >
          {callId ? "See the call" : "Open inbox"}
        </Link>
        <button
          type="button"
          onClick={() => {
            onSeen();
            router.push("/home");
          }}
          className={buttonClass({ variant: "primary", size: "md" })}
        >
          Go to Home
        </button>
      </div>
    </section>
  );
}
