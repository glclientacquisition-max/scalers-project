import { ButtonLink } from "@/components/ui/Button";

import { deskEmptyClass } from "@/components/ui/deskChrome";

/**
 * Page-slot miss: one title, an optional line, one filled action.
 * `screen` centers the same block on a blank page (root 404). No second shell.
 */
export function DeskRecovery({
  title,
  line,
  href,
  action,
  screen = false,
}: {
  title: string;
  line?: string;
  href: string;
  action: string;
  screen?: boolean;
}) {
  const block = (
    <div className={screen ? "w-full max-w-md text-center" : deskEmptyClass}>
      <h1 className="font-display text-page tracking-tight text-ink">{title}</h1>
      {line ? <p className="mx-auto mt-2 max-w-sm text-body text-ink-2">{line}</p> : null}
      <ButtonLink href={href} className="mt-6">
        {action}
      </ButtonLink>
    </div>
  );

  if (!screen) return block;

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">{block}</main>
  );
}
