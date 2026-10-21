"use client";

import { notify } from "@/components/ui/DeskNotice";
import { buttonClass } from "@/components/ui/Button";
import { cx } from "@/lib/cx";

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea copy */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * A code the owner types or pastes: large monospace text, Copy, and an optional
 * tap-to-dial link (pass `dial` only where a link may show, see dialHref).
 * Copy puts the raw code on the clipboard with a real `#`.
 */
export function CopyCode({
  code,
  label,
  dial,
  size = "lg",
  className,
}: {
  code: string;
  /** Short lead, e.g. "Turn on". */
  label?: string;
  dial?: string | null;
  size?: "lg" | "sm";
  className?: string;
}) {
  return (
    <div className={cx("min-w-0 rounded-xl bg-surface-2 px-3 pb-2.5 pt-1", className)}>
      <div className="flex min-h-11 items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-meta font-medium text-ink-2">{label}</p>
        <button
          type="button"
          className={buttonClass({ variant: "ghost", size: "sm", className: "min-h-11 text-accent" })}
          aria-label={`Copy ${code}`}
          onClick={async () => {
            const ok = await copyText(code);
            notify(ok ? "Copied. Paste it in your Phone app." : "Could not copy. Type the code instead.");
          }}
        >
          Copy
        </button>
        {dial ? (
          <a
            href={dial}
            className={buttonClass({ variant: "tonal", size: "sm", className: "min-h-11" })}
            aria-label={`Dial ${code}`}
          >
            Dial
          </a>
        ) : null}
      </div>
      <code
        translate="no"
        className={cx(
          "block select-all overflow-x-auto whitespace-nowrap font-mono font-semibold tabular-nums text-ink [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          size === "lg" ? "text-title" : "text-body",
        )}
      >
        {code}
      </code>
    </div>
  );
}
