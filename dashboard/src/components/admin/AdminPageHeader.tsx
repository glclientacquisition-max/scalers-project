/**
 * Super Admin list roots: title + one-line job description. Opens on the work, not a hero block.
 */
export function AdminPageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="px-4 pb-3 pt-1">
      <h1 className="text-page text-ink">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-meta text-ink-2">{subtitle}</p> : null}
    </header>
  );
}
