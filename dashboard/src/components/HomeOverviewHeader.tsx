export function HomeOverviewHeader({
  today,
}: {
  today: { iso: string; label: string };
}) {
  return (
    <header className="min-w-0">
      <p className="truncate text-sm text-ink-soft">
        <time dateTime={today.iso}>{today.label}</time>
      </p>
    </header>
  );
}
