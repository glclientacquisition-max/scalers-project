export function ContactSparkline({
  days,
}: {
  days: Array<{ day: string; count: number }>;
}) {
  if (!days.length || !days.some((day) => day.count > 0)) return null;
  const max = Math.max(...days.map((day) => day.count), 1);
  return (
    <ol
      data-contact-sparkline=""
      aria-label="Daily interactions"
      className="flex h-8 min-w-0 items-end gap-0.5"
    >
      {days.map((day) => (
        <li
          key={day.day}
          title={`${day.day}: ${day.count}`}
          className="min-h-0 min-w-0 flex-1 rounded-sm bg-[#0096FF]"
          style={{ height: `${Math.max(8, Math.round((day.count / max) * 100))}%` }}
        />
      ))}
    </ol>
  );
}
