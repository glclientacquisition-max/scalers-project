export function ContactSparkline({
  days,
}: {
  days: Array<{ day: string; count: number }>;
}) {
  if (!days.length || !days.some((day) => day.count > 0)) return null;
  const max = Math.max(...days.map((day) => day.count), 1);
  const track = 32;
  return (
    <div className="min-w-0" data-contact-sparkline="">
      <p className="text-xs font-medium text-ink-soft">Daily interactions</p>
      <ol aria-label="Daily interactions" className="mt-2 flex h-8 min-w-0 items-end gap-0.5">
        {days.map((day) => (
          <li
            key={day.day}
            title={`${day.day}: ${day.count}`}
            className="min-w-0 flex-1 self-end rounded-sm bg-brand"
            style={{ height: `${Math.max(2, Math.round((day.count / max) * track))}px` }}
          />
        ))}
      </ol>
    </div>
  );
}
