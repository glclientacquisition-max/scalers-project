export function HomeOverviewHeader({
  today,
}: {
  today: { iso: string; label: string };
}) {
  return (
    <header className="min-w-0">
      <p className="truncate text-body text-ink-2">
        <time dateTime={today.iso}>{today.label}</time>
      </p>
    </header>
  );
}
